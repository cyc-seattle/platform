# FreeScout, run as a non-root user on a read-only root filesystem (cyc-seattle/platform#182).
# Everything FreeScout writes is under /data (the disk) or /cache (scratch); see freescout-start.

FROM php:8.3-fpm-alpine3.22 AS php

RUN apk add --no-cache nginx icu-libs libpng libjpeg-turbo freetype libzip libpq \
  && apk add --no-cache --virtual .build icu-dev libpng-dev libjpeg-turbo-dev freetype-dev libzip-dev postgresql-dev \
  && docker-php-ext-configure gd --with-jpeg --with-freetype \
  && docker-php-ext-install -j"$(nproc)" gd intl pcntl pdo_pgsql zip \
  && apk del .build

FROM alpine:3.22 AS source
# renovate: datasource=github-tags depName=freescout-help-desk/freescout
ARG FREESCOUT_VERSION=1.8.252
RUN wget -qO- "https://github.com/freescout-help-desk/freescout/archive/refs/tags/${FREESCOUT_VERSION}.tar.gz" \
  | tar xz -C /tmp && mv "/tmp/freescout-${FREESCOUT_VERSION}" /app
# Each folder FreeScout writes to points out of the read-only image.
RUN cd /app \
  && rm -rf storage Modules public/modules public/css/builds public/js/builds bootstrap/cache .env.example \
  && ln -s /data/storage storage \
  && ln -s /data/Modules Modules \
  && ln -s /data/.env .env \
  && ln -s /data/public-modules public/modules \
  && ln -s /cache/css-builds public/css/builds \
  && ln -s /cache/js-builds public/js/builds \
  && ln -s /cache/bootstrap bootstrap/cache \
  && ln -sfn ../storage/app/public public/storage

FROM php
COPY --from=source /app /app
COPY nginx.conf /etc/nginx/nginx.conf
COPY php-fpm.conf /usr/local/etc/php-fpm.d/zz-freescout.conf
COPY php.ini /usr/local/etc/php/conf.d/zz-freescout.ini
COPY freescout-start /usr/local/bin/freescout-start
COPY configure.php /usr/local/lib/freescout/configure.php
# A new volume takes its mount point's owner, so it starts out writable by www-data.
RUN mkdir /data /cache && chown 82:82 /data /cache
WORKDIR /app
# www-data, by number, so runAsNonRoot can check it.
USER 82:82
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/freescout-start"]
