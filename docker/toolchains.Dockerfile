FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS base

WORKDIR /workspace

FROM base AS c-cpp
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*
RUN install -d -m 0755 /opt/arclis
COPY --chmod=0444 native_job.py /opt/arclis/native_job.py
USER 65534:65534

FROM base AS java
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jdk-headless python3 \
    && rm -rf /var/lib/apt/lists/*
RUN install -d -m 0755 /opt/arclis
COPY --chmod=0444 native_job.py /opt/arclis/native_job.py
USER 65534:65534

FROM base AS python
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
RUN install -d -m 0755 /opt/arclis
COPY --chmod=0444 native_job.py /opt/arclis/native_job.py
USER 65534:65534

FROM python AS python-analyzer
COPY --chmod=0444 python_analysis.py /opt/arclis/python_analysis.py
