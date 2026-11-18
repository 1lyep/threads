#!/bin/sh
set -eu
root=$1
case $(uname -s) in Darwin) os=darwin;; Linux) os=linux;; *) echo 'Unsupported operating system' >&2; exit 1;; esac
case $(uname -m) in arm64|aarch64) arch=arm64;; x86_64) arch=x64;; *) echo 'Requires x64 or ARM64' >&2; exit 1;; esac
version=v24.22.3
name=node-$version-$os-$arch
file=$name.tar.gz
expected=$(awk -v f="$file" '$2 == f { print $1 }' "$root/scripts/node-shasums.txt")
test -n "$expected"
tmp=$(mktemp -d "$root/.runtime-download.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 2 "https://nodejs.org/dist/$version/$file" -o "$tmp/$file"
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1)
else
  actual=$(sha256sum "$tmp/$file" | cut -d ' ' -f 1)
fi
if [ "$actual" != "$expected" ]; then echo 'Node.js checksum mismatch' >&2; exit 1; fi
tar -xzf "$tmp/$file" -C "$tmp" "$name/bin/node" "$name/LICENSE"
mkdir -p "$root/runtime"
mv "$tmp/$name/LICENSE" "$root/runtime/LICENSE"
mv "$tmp/$name/bin/node" "$root/runtime/node"
