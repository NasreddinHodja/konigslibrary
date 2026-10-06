# The headless server's image, from what release-docker.yml built: the build
# context has client/, an empty config/, and konigslibrary-server-<arch> for
# each platform. Like Komga's and Kavita's images, it copies binaries CI built
# natively for each architecture, so building it compiles and runs nothing.
#
# Ubuntu 24.04, the glibc the binaries were built against.
FROM ubuntu:24.04
ARG TARGETARCH

COPY client /app/client
COPY --chmod=755 konigslibrary-server-${TARGETARCH} /app/konigslibrary-server
# konigslibrary.json and both databases; owned by the user it runs as.
COPY --chown=1000:1000 config /config

ENV HOST=0.0.0.0 \
    PORT=5511 \
    MANGA_DIR=/manga \
    NO_BROWSER=1
WORKDIR /config
VOLUME /config
EXPOSE 5511
USER 1000:1000
ENTRYPOINT ["/app/konigslibrary-server"]
