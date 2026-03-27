"use client";

import * as fabric from "fabric";
import paper from "paper";

export function initDrawContexts() {
  // Initialize paper.js context
  paper.setup([1, 1]);
  paper.settings.insertItems = false;
  paper.view.autoUpdate = false; // disables drawing any shape automatically

  // Set global fabric.js defaults
  fabric.InteractiveFabricObject.ownDefaults = {
    ...fabric.InteractiveFabricObject.ownDefaults,
    cornerStrokeColor: "white",
    cornerColor: "lightblue",
    cornerStyle: "circle",
    cornerSize: 12,
    padding: 0,
    transparentCorners: false,
    borderColor: "grey",
    borderScaleFactor: 1.2,
  };

  // Remove rotation handle globally
  fabric.InteractiveFabricObject.ownDefaults.controls = (() => {
    const controls = fabric.FabricObject.createControls().controls;
    delete controls.mtr;
    return controls;
  })();
}
