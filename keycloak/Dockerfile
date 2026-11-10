# Stage 1: write the brand CSS from plan.json.
FROM node:26-alpine AS brand
WORKDIR /w
COPY plan.json keycloak/apply-brand.mjs ./
COPY keycloak/themes ./themes
RUN node apply-brand.mjs plan.json themes/app/login/resources/css/brand.css

# Stage 2: optimized Keycloak build for Postgres with health endpoints.
FROM quay.io/keycloak/keycloak:26.8.2 AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

# Stage 3: runtime with the realm import and branded theme baked in.
FROM quay.io/keycloak/keycloak:26.8.2
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --from=brand /w/themes/app /opt/keycloak/themes/app
COPY keycloak/realm.json /opt/keycloak/data/import/realm.json
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
