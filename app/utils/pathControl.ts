import type {
  Path,
  TMat2D,
  TModificationEvents,
  TPointerEvent,
  TSimpleParseCommandType,
  Transform,
} from "fabric";
import * as fabric from "fabric";
import {
  BasicTransformEvent,
  Control,
  ObjectModificationEvents,
  Point,
  TransformAction,
} from "fabric";

import {
  ControlRenderingStyleOverride,
  renderCircleControl,
  renderDiamondControl,
  renderSquareControl,
} from "@/app/utils/renderControl";

const fireEvent = (
  eventName: TModificationEvents,
  options: ObjectModificationEvents[typeof eventName],
) => {
  const {
    transform: { target },
  } = options;
  target.canvas?.fire(`object:${eventName}`, {
    ...options,
    target,
  });
  target.fire(eventName, options);
};

const commonEventInfo: TransformAction<Transform, BasicTransformEvent> = (
  eventData,
  transform,
  x,
  y,
) => {
  return {
    e: eventData,
    transform,
    pointer: new Point(x, y),
  };
};

const ACTION_NAME: TModificationEvents = "modifyPath" as const;

type TTransformAnchor = Transform;

export type PathPointControlStyle = {
  controlSize?: number;
  controlStyle?: "rect" | "circle" | "diamond";
  controlFill?: string;
  controlSelectedFill?: string;
  controlSelectedSize?: number;
  controlStroke?: string;
  controlStrokeWidth?: number;
  controlDropShadowColor?: string;
  controlDropShadowSize?: number;
  connectionStroke?: string;
  strokeCompositeOperation?: GlobalCompositeOperation;
  connectionDashArray?: number[];
};

const calcPathPointPosition = (
  pathObject: Path,
  commandIndex: number,
  pointIndex: number,
) => {
  const { path, pathOffset } = pathObject;
  const command = path[commandIndex];
  return new Point(
    (command[pointIndex] as number) - pathOffset.x,
    (command[pointIndex + 1] as number) - pathOffset.y,
  ).transform(
    fabric.util.multiplyTransformMatrices(
      pathObject.getViewportTransform(),
      pathObject.calcTransformMatrix(),
    ),
  );
};

const movePathPoint = (
  pathObject: Path,
  x: number,
  y: number,
  commandIndex: number,
  pointIndex: number,
  linkedPoints: Array<{ commandIndex: number; pointIndex: number }> = [],
) => {
  const { path, pathOffset } = pathObject;

  const anchorCommand =
    path[(commandIndex > 0 ? commandIndex : path.length) - 1];
  const anchorPoint = new Point(
    anchorCommand[pointIndex] as number,
    anchorCommand[pointIndex + 1] as number,
  );

  const anchorPointInParentPlane = anchorPoint
    .subtract(pathOffset)
    .transform(pathObject.calcOwnMatrix());

  const mouseLocalPosition = fabric.util.sendPointToPlane(
    new Point(x, y),
    undefined,
    pathObject.calcOwnMatrix(),
  );

  // Compute delta in path-data space before setDimensions() updates pathOffset
  const deltaX =
    mouseLocalPosition.x +
    pathOffset.x -
    (path[commandIndex][pointIndex] as number);
  const deltaY =
    mouseLocalPosition.y +
    pathOffset.y -
    (path[commandIndex][pointIndex + 1] as number);

  path[commandIndex][pointIndex] = mouseLocalPosition.x + pathOffset.x;
  path[commandIndex][pointIndex + 1] = mouseLocalPosition.y + pathOffset.y;

  for (const lp of linkedPoints) {
    (path[lp.commandIndex][lp.pointIndex] as number) += deltaX;
    (path[lp.commandIndex][lp.pointIndex + 1] as number) += deltaY;
  }

  pathObject.setDimensions();

  const newAnchorPointInParentPlane = anchorPoint
    .subtract(pathObject.pathOffset)
    .transform(pathObject.calcOwnMatrix());

  const diff = newAnchorPointInParentPlane.subtract(anchorPointInParentPlane);
  pathObject.left -= diff.x;
  pathObject.top -= diff.y;
  pathObject.set("dirty", true);
  return true;
};

/**
 * This function locates the controls.
 * It'll be used both for drawing and for interaction.
 */
function pathPositionHandler(
  this: PathPointControl,
  dim: Point,
  finalMatrix: TMat2D,
  pathObject: Path,
) {
  const { commandIndex, pointIndex } = this;
  return calcPathPointPosition(pathObject, commandIndex, pointIndex);
}

/**
 * This function defines what the control does.
 * It'll be called on every mouse move after a control has been clicked and is being dragged.
 * The function receives as argument the mouse event, the current transform object
 * and the current position in canvas coordinate `transform.target` is a reference to the
 * current object being transformed.
 */
function pathActionHandler(
  this: PathPointControl,
  eventData: TPointerEvent,
  transform: TTransformAnchor,
  x: number,
  y: number,
) {
  const { target } = transform;
  // Suppress the move until the pointer has dragged past the threshold, then
  // latch so it keeps dragging even if it comes back within tolerance.
  if (withinTolerance) {
    const canvas = target.canvas;
    if (dragOrigin && canvas) {
      const p = canvas.getViewportPoint(eventData);
      if (
        Math.hypot(p.x - dragOrigin.x, p.y - dragOrigin.y) < DRAG_THRESHOLD_PX
      ) {
        return false;
      }
    }
    withinTolerance = false;
  }
  const { commandIndex, pointIndex, linkedControlPoints } = this;
  const actionPerformed = movePathPoint(
    target as Path,
    x,
    y,
    commandIndex,
    pointIndex,
    linkedControlPoints,
  );
  if (actionPerformed) {
    fireEvent(this.actionName as TModificationEvents, {
      ...commonEventInfo(eventData, transform, x, y),
      commandIndex,
      pointIndex,
    });
  }
  return actionPerformed;
}

const indexFromPrevCommand = (previousCommandType: TSimpleParseCommandType) =>
  previousCommandType === "C" ? 5 : previousCommandType === "Q" ? 3 : 1;

// Inkscape-style click/drag threshold: the pointer must move at least this many
// screen pixels from the grab point before a node drag begins; less is a click.
// Measured in viewport (screen) pixels, so it's independent of the canvas zoom.
const DRAG_THRESHOLD_PX = 4;
let dragOrigin: Point | null = null;
// True until the pointer has moved past the threshold; once it flips off the
// drag continues even if the pointer returns within tolerance (matches
// Inkscape's `within_tolerance`).
let withinTolerance = true;

const selectedControls: PathPointControl[] = [];
const lastControlPoints: Control[] = [];
let hoveredControl: PathPointControl | null = null;
const listenedCanvases = new WeakSet<fabric.StaticCanvas>();

function setupHoverTracking(canvas: fabric.StaticCanvas): void {
  if (listenedCanvases.has(canvas)) return;
  listenedCanvases.add(canvas);
  const iCanvas = canvas as fabric.Canvas;
  iCanvas.on("mouse:move", (opt: { e: TPointerEvent }) => {
    const pointer = iCanvas.getViewportPoint(opt.e);
    let found: PathPointControl | null = null;
    outer: for (const obj of canvas.getObjects()) {
      for (const ctrl of Object.values(obj.controls)) {
        if (!(ctrl instanceof PathPointControl) || !ctrl.visible) continue;
        const pos = calcPathPointPosition(
          obj as fabric.Path,
          ctrl.commandIndex,
          ctrl.pointIndex,
        );
        const halfSize = (ctrl.controlSize || obj.cornerSize) / 2;
        if (
          Math.abs(pointer.x - pos.x) <= halfSize &&
          Math.abs(pointer.y - pos.y) <= halfSize
        ) {
          found = ctrl;
          break outer;
        }
      }
    }
    if (hoveredControl !== found) {
      hoveredControl = found;
      canvas.requestRenderAll();
    }
  });
}

class PathPointControl extends Control {
  declare commandIndex: number;
  declare pointIndex: number;
  declare linkedControlPoints: Array<{
    commandIndex: number;
    pointIndex: number;
  }>;
  declare controlFill: string;
  declare controlSelectedFill: string | undefined;
  declare controlSelectedSize: number | undefined;
  declare controlStroke: string;
  declare controlStrokeWidth: number | undefined;
  declare controlDropShadowColor: string | undefined;
  declare controlDropShadowSize: number | undefined;
  declare controlSize: number;
  declare controlStyle: "rect" | "circle" | "diamond" | undefined;
  declare strokeCompositeOperation?: GlobalCompositeOperation;
  constructor(options?: Partial<PathPointControl>) {
    super(options);
  }

  render(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: ControlRenderingStyleOverride | undefined,
    fabricObject: Path,
  ) {
    if (fabricObject.canvas) setupHoverTracking(fabricObject.canvas);

    const overrides: ControlRenderingStyleOverride = {
      ...styleOverride,
      cornerSize: this.controlSize,
      cornerColor: this.controlFill,
      cornerStrokeColor: this.controlStroke,
      cornerStrokeWidth: this.controlStrokeWidth,
      cornerDropShadowColor: this.controlDropShadowColor,
      cornerDropShadowSize: this.controlDropShadowSize,
      cornerStyle: this.controlStyle,
      transparentCorners: !this.controlFill,
      cornerCompositeOperation: this.strokeCompositeOperation,
    };

    const parentAnchor = (this as Partial<PathControlPointControl>)
      .parentAnchor;
    const selectedAnchor = selectedControls.includes(this)
      ? this
      : parentAnchor && selectedControls.includes(parentAnchor)
        ? parentAnchor
        : undefined;
    if (selectedAnchor) {
      overrides.cornerColor = selectedAnchor.controlSelectedFill ?? "cyan";
      if (selectedAnchor.controlSelectedSize !== undefined) {
        overrides.cornerSize = selectedAnchor.controlSelectedSize;
      }
    } else if (hoveredControl === this) {
      overrides.cornerColor = this.controlSelectedFill ?? "cyan";
    }

    switch (this.controlStyle || fabricObject.cornerStyle) {
      case "circle":
        renderCircleControl.call(this, ctx, left, top, overrides, fabricObject);
        break;
      case "diamond":
        renderDiamondControl.call(
          this,
          ctx,
          left,
          top,
          overrides,
          fabricObject,
        );
        break;
      default:
        renderSquareControl.call(this, ctx, left, top, overrides, fabricObject);
    }
  }
}

class PathControlPointControl extends PathPointControl {
  declare connectionDashArray?: number[];
  declare connectToCommandIndex: number;
  declare connectToPointIndex: number;
  declare connectionStroke?: string;
  declare parentAnchor: PathPointControl | undefined;
  constructor(options?: Partial<PathControlPointControl>) {
    super(options);
  }

  render(
    this: PathControlPointControl,
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: ControlRenderingStyleOverride | undefined,
    fabricObject: Path,
  ) {
    const { path } = fabricObject;
    const {
      commandIndex,
      pointIndex,
      connectToCommandIndex,
      connectToPointIndex,
    } = this;
    const [commandType] = path[commandIndex];

    ctx.save();

    const anchorKey = `c_${connectToCommandIndex}_${path[connectToCommandIndex][0]}`;
    const anchorCtrl = fabricObject.controls[anchorKey] as
      | PathPointControl
      | undefined;
    const anchorGap =
      (anchorCtrl?.controlSize ?? fabricObject.cornerSize) / 2 +
      (anchorCtrl?.controlStrokeWidth ?? 0) / 2;

    function drawLine() {
      ctx.beginPath();
      const point = calcPathPointPosition(
        fabricObject,
        connectToCommandIndex,
        connectToPointIndex,
      );

      if (commandType === "Q") {
        // one control point connects to 2 points
        const point2 = calcPathPointPosition(
          fabricObject,
          commandIndex,
          pointIndex + 2,
        );
        ctx.moveTo(point2.x, point2.y);
        ctx.lineTo(left, top);
      } else {
        ctx.moveTo(left, top);
      }

      let dx = point.x - left;
      let dy = point.y - top;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > anchorGap) {
        dx *= anchorGap / dist;
        dy *= anchorGap / dist;
        ctx.lineTo(point.x - dx, point.y - dy);
      }
    }

    drawLine();
    if (this.connectionDashArray) {
      ctx.setLineDash(this.connectionDashArray);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = "white";
    ctx.stroke();

    drawLine();
    if (this.connectionDashArray) {
      ctx.setLineDash(this.connectionDashArray);
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.connectionStroke || "blue";
    ctx.stroke();

    ctx.restore();

    super.render(ctx, left, top, styleOverride, fabricObject);
  }
}

const createControl = (
  commandIndexPos: number,
  pointIndexPos: number,
  isControlPoint: boolean,
  options: Partial<Control> & {
    controlPointStyle?: PathPointControlStyle;
    pointStyle?: PathPointControlStyle;
  },
  controlPoints: Record<number, { key: string; control: Control }[]>,
  connectToCommandIndex?: number,
  connectToPointIndex?: number,
) => {
  const ControlClass = isControlPoint
    ? PathControlPointControl
    : PathPointControl;
  const control = new ControlClass({
    visible: !isControlPoint,
    commandIndex: commandIndexPos,
    pointIndex: pointIndexPos,
    linkedControlPoints: [],
    actionName: ACTION_NAME,
    positionHandler: pathPositionHandler,
    actionHandler: pathActionHandler,
    mouseDownHandler: (event, transform) => {
      dragOrigin = transform.target.canvas?.getViewportPoint(event) ?? null;
      withinTolerance = true;
      const path = transform.target as Path;
      if (!isControlPoint) {
        if (!event.ctrlKey && !event.shiftKey) {
          deselectPathControls();
        }
        if (selectedControls.includes(control)) {
          // Deselect
          selectedControls.splice(selectedControls.indexOf(control), 1);
          const cps = controlPoints[commandIndexPos];
          if (cps) {
            cps.forEach(({ control: cp }) => {
              const cpIndex = lastControlPoints.indexOf(cp);
              if (cpIndex !== -1) {
                lastControlPoints.splice(cpIndex, 1);
              }
              cp.visible = false;
            });
          }
        } else {
          selectedControls.push(control);
          const cps = controlPoints[commandIndexPos];
          if (cps) {
            cps.forEach(({ control: cp }) => {
              lastControlPoints.push(cp);
              cp.visible = true;
            });
          }
        }
        path.canvas?.requestRenderAll();
        return true;
      }
      return false;
    },
    connectToCommandIndex,
    connectToPointIndex,
    ...options,
    ...(isControlPoint ? options.controlPointStyle : options.pointStyle),
  } as Partial<PathControlPointControl>);
  return control;
};

export function createPathControls(
  path: Path,
  options: Partial<Control> & {
    controlPointStyle?: PathPointControlStyle;
    pointStyle?: PathPointControlStyle;
  } = {},
): Record<string, Control> {
  const controls = {} as Record<string, Control>;
  let previousCommandType: TSimpleParseCommandType = "M";
  const controlPoints: Record<number, { key: string; control: Control }[]> = {};
  path.path.forEach((command, commandIndex) => {
    const commandType = command[0];

    if (commandType !== "Z") {
      controls[`c_${commandIndex}_${commandType}`] = createControl(
        commandIndex,
        command.length - 2,
        false,
        options,
        controlPoints,
      );
    }
    switch (commandType) {
      case "C":
        if (!controlPoints[commandIndex - 1]) {
          controlPoints[commandIndex - 1] = [];
        }
        controlPoints[commandIndex - 1].push({
          key: `c_${commandIndex}_C_CP_1`,
          control: createControl(
            commandIndex,
            1,
            true,
            options,
            controlPoints,
            commandIndex - 1,
            indexFromPrevCommand(previousCommandType),
          ),
        });
        if (!controlPoints[commandIndex]) {
          controlPoints[commandIndex] = [];
        }
        controlPoints[commandIndex].push({
          key: `c_${commandIndex}_C_CP_2`,
          control: createControl(
            commandIndex,
            3,
            true,
            options,
            controlPoints,
            commandIndex,
            5,
          ),
        });
        break;
      case "Q":
        if (!controlPoints[commandIndex]) {
          controlPoints[commandIndex] = [];
        }
        controlPoints[commandIndex].push({
          key: `c_${commandIndex}_Q_CP_1`,
          control: createControl(
            commandIndex,
            1,
            true,
            options,
            controlPoints,
            commandIndex,
            3,
          ),
        });
        break;
    }
    previousCommandType = commandType;
  });

  for (const cps of Object.values(controlPoints)) {
    cps.forEach(({ key, control }) => {
      controls[key] = control;
    });
  }

  // Attach linked handle positions to each anchor control so that dragging an
  // anchor also translates its associated bezier handles by the same delta.
  for (const [cmdIdxStr, cps] of Object.entries(controlPoints)) {
    const cmdIdx = parseInt(cmdIdxStr);
    const commandType = path.path[cmdIdx][0] as TSimpleParseCommandType;
    const anchorControl = controls[`c_${cmdIdx}_${commandType}`] as
      | PathPointControl
      | undefined;
    if (anchorControl) {
      anchorControl.linkedControlPoints = cps.map(({ control: cp }) => ({
        commandIndex: (cp as PathControlPointControl).commandIndex,
        pointIndex: (cp as PathControlPointControl).pointIndex,
      }));
      cps.forEach(({ control: cp }) => {
        (cp as PathControlPointControl).parentAnchor = anchorControl;
      });
    }
  }

  return controls;
}

export function deselectPathControls() {
  lastControlPoints.forEach((cp) => {
    cp.visible = false;
  });
  selectedControls.length = 0;
}
