import "@microsoft/opentelemetry/loader";
import { useMicrosoftOpenTelemetry } from "@microsoft/opentelemetry";

// Loaded with `node --import` so instrumentation hooks register before the app code.
// Does nothing when no connection string is set (local dev, tests).
const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  useMicrosoftOpenTelemetry({
    azureMonitor: { azureMonitorExporterOptions: { connectionString } },
  });
}
