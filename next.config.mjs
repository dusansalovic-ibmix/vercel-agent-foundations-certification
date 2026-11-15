import { withWorkflow } from "workflow/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["@vercel/oidc"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "**.vercel-storage.com",
      },
    ],
  },
};

// `withWorkflow` compiles the "use workflow" / "use step" directives used by
// the durable agents in `lib/workflows/*` and generates the internal
// `/.well-known/workflow/v1/*` routes that drive them.
export default withWorkflow(nextConfig);
