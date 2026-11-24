# SPDX-License-Identifier: Apache-2.0
#
# The quiet host for a counted plant run (D-95), as a container on the owner's dev host. It holds only what a plant
# wave needs: Node 22, Python 3.12 with cedarpy 4.12.2, util-linux (unshare) and git. The checkout, the counted set, the
# wave dir and the pinned kiro-cli are mounted at run time by quiet-host.sh; nothing private is baked into the image.
# The container gets its own network namespace (no listeners) and publishes no port.

FROM public.ecr.aws/amazonlinux/amazonlinux:2023

RUN dnf -y install nodejs22 python3.12 util-linux git tar gzip shadow-utils && dnf clean all \
 && { command -v node >/dev/null || ln -s "$(ls /usr/bin/node-22* | head -1)" /usr/local/bin/node; } \
 && node --version | grep -q '^v22\.'

RUN python3.12 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir cedarpy==4.12.2 \
 && /opt/venv/bin/python -c 'import cedarpy'

# The owner's uid, so the bind-mounted wave dir stays the owner's.
ARG UID=1000
RUN useradd -m -u "${UID}" bench
USER bench
WORKDIR /home/bench
ENV TMPDIR=/tmp
