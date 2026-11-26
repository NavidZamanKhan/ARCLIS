FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS base

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev make flex bison \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY *.c *.h lexer.l parser.y Makefile ./
RUN make -j2 all CFLAGS='-std=c17 -Wall -Wextra -Wpedantic -Werror -O2'

FROM base
COPY --from=build /build/build/arclis-lex /build/build/arclis-parse /opt/arclis/
WORKDIR /workspace
USER 65534:65534
