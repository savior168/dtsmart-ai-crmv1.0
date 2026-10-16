import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

// Local recovery builds may skip the workflow compiler when its optional native
// SWC binary is unavailable. Production/Vercel always compiles workflows.
export default process.env.SKIP_WORKFLOW_BUILD === "1" ? nextConfig : withWorkflow(nextConfig);
