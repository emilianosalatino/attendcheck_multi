import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Validacion estricta de TypeScript en build (CWE-1004):
  // Antes estaba ignoreBuildErrors: true, que permitia que pasaran errores
  // de tipos al production. Lo apago para que cualquier error TS falle el
  // build en Render y nos avise antes de deployar.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
