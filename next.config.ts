import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/login",
        headers: [
          // The previous middleware bug could leave an oversized session
          // cookie set in one browser. Clear cookies when entering the login
          // page so that the next authentication request starts clean.
          { key: "Clear-Site-Data", value: '"cookies"' },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

// Local recovery builds may skip the workflow compiler when its optional native
// SWC binary is unavailable. Production/Vercel always compiles workflows.
export default process.env.SKIP_WORKFLOW_BUILD === "1" ? nextConfig : withWorkflow(nextConfig);
