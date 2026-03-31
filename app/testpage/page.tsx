"use client";

import { Box } from "@mui/system";
import { useState } from "react";

import { GlyphView } from "@/app/components/GlyphView";
import PathData from "@/app/pathUtils/PathData";
import * as testPaths from "@/app/testpage/testPaths";
import { initDrawContexts } from "@/app/utils/init";

export default function TestPage() {
  useState(() => initDrawContexts());

  const [path, setPath] = useState(() =>
    PathData.fromSvg(testPaths.nieun_chieuch),
  );

  return (
    <Box
      sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
      className="h-screen w-screen bg-stone-100 flex-col"
    >
      <div>GlyphView Test</div>
      <GlyphView
        className="outline outline-stone-500 rounded-lg overflow-hidden"
        width={700}
        height={700}
        interactive={true}
        path={path}
        onPathChanged={(newPath: PathData | null) => {
          if (newPath) {
            setPath(newPath);
          }
        }}
      />
    </Box>
  );
}
