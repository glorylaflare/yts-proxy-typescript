import { createApp } from "./http/app.ts";
import { defaultConfig } from "./config/app-config.ts";

const app = createApp(defaultConfig);

app.listen(defaultConfig.port, () => {
  console.log(`yts-proxy: abra http://localhost:${defaultConfig.port}/`);
  console.log(`API:       http://localhost:${defaultConfig.port}/movies?year=2025&month=3`);
  console.log(`upstream:  ${defaultConfig.ytsApiBaseUrl}`);
});
