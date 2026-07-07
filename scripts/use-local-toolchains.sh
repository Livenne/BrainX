#!/usr/bin/env bash

# Source this file before running S/C tests:
#   source scripts/use-local-toolchains.sh

export BRAINX_TOOLCHAINS="${BRAINX_TOOLCHAINS:-$HOME/.local/share/brainx-toolchains}"
export JAVA_HOME="$BRAINX_TOOLCHAINS/openjdk-21/usr/lib/jvm/java-21-openjdk-amd64"
export MAVEN_HOME="$BRAINX_TOOLCHAINS/maven"
export BRAINX_RUST_HOME="$BRAINX_TOOLCHAINS/rust"

export PATH="$MAVEN_HOME/bin:$JAVA_HOME/bin:$BRAINX_RUST_HOME/usr/bin:$PATH"
export LD_LIBRARY_PATH="$BRAINX_RUST_HOME/usr/lib/x86_64-linux-gnu:$BRAINX_RUST_HOME/usr/lib:${LD_LIBRARY_PATH:-}"
