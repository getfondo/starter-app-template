-- Runs once on first local Postgres start. Creates the keycloak role and database next to the app database.
CREATE ROLE keycloak WITH LOGIN PASSWORD 'keycloak';
CREATE DATABASE keycloak OWNER keycloak;
