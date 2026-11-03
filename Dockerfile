# mcp-review-check image: installs the PUBLISHED npm package, not the checkout.
#   docker build --build-arg VERSION=0.5.0 -t mcp-review-check .
#   docker run --rm mcp-review-check https://mcp.example.com/mcp --target claude
# Base image pinned by digest (node:22-alpine, multi-arch index, resolved 2026-11-03); refresh it with Node 22 patch releases.

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
ARG VERSION
RUN test -n "$VERSION" || { echo "build-arg VERSION is required (for example 0.5.0)" >&2; exit 1; }
# No install scripts of the package or its dependencies run.
RUN npm install --global --ignore-scripts --no-audit --no-fund "mcp-review-check@${VERSION}" \
 && npm cache clean --force

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ARG VERSION
LABEL org.opencontainers.image.title="mcp-review-check" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/alisaosipova/mcp-review-check" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /usr/local/lib/node_modules/mcp-review-check /usr/local/lib/node_modules/mcp-review-check
RUN ln -s ../lib/node_modules/mcp-review-check/dist/cli.js /usr/local/bin/mcp-review-check \
 && chmod +x /usr/local/lib/node_modules/mcp-review-check/dist/cli.js \
 && adduser -D -u 10001 reviewer
USER reviewer
WORKDIR /home/reviewer
ENV NO_UPDATE_NOTIFIER=1
ENTRYPOINT ["mcp-review-check"]
CMD ["--help"]
