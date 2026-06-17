// Dynamic Expo config: overlays app.json with a web base URL when hosting under
// a subpath (e.g. a GitHub project page served at /LukiPuk1e/). Local dev leaves
// STOCKPILE_BASE_URL unset, so the app builds/serves at root as usual; the Pages
// workflow sets it so absolute asset and route paths resolve correctly.
module.exports = ({ config }) => {
  const baseUrl = process.env.STOCKPILE_BASE_URL;
  if (!baseUrl) return config;
  return {
    ...config,
    experiments: { ...(config.experiments ?? {}), baseUrl },
  };
};
