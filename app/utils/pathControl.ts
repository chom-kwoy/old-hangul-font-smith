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
  controlStyle?: "rect" | "circle";
  controlFill?: string;
  controlStroke?: string;
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

  path[commandIndex][pointIndex] = mouseLocalPosition.x + pathOffset.x;
  path[commandIndex][pointIndex + 1] = mouseLocalPosition.y + pathOffset.y;
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
  const { commandIndex, pointIndex } = this;
  const actionPerformed = movePathPoint(
    target as Path,
    x,
    y,
    commandIndex,
    pointIndex,
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

const selectedControls: PathPointControl[] = [];
const lastControlPoints: Control[] = [];

class PathPointControl extends Control {
  declare commandIndex: number;
  declare pointIndex: number;
  declare controlFill: string;
  declare controlStroke: string;
  declare controlSize: number;
  declare controlStyle: "rect" | "circle" | undefined;
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
    const overrides: ControlRenderingStyleOverride = {
      ...styleOverride,
      cornerSize: this.controlSize,
      cornerColor: this.controlFill,
      cornerStrokeColor: this.controlStroke,
      cornerStyle: this.controlStyle,
      transparentCorners: !this.controlFill,
      cornerCompositeOperation: this.strokeCompositeOperation,
    };

    if (selectedControls.includes(this)) {
      overrides.cornerColor = "cyan";
    }

    switch (overrides.cornerStyle || fabricObject.cornerStyle) {
      case "circle":
        renderCircleControl.call(this, ctx, left, top, overrides, fabricObject);
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
    const { path, controls } = fabricObject;
    const {
      commandIndex,
      pointIndex,
      connectToCommandIndex,
      connectToPointIndex,
    } = this;
    const [commandType] = path[commandIndex];

    const parentControl = controls[`c_${connectToCommandIndex}_${commandType}`];

    super.render(ctx, left, top, styleOverride, fabricObject);

    const radius =
      (this.sizeX || this.controlSize || fabricObject.cornerSize) / 2;

    ctx.save();

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
      dx *= radius / dist;
      dy *= radius / dist;
      ctx.lineTo(point.x - dx, point.y - dy);
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
    actionName: ACTION_NAME,
    positionHandler: pathPositionHandler,
    actionHandler: pathActionHandler,
    mouseDownHandler: (event, transform) => {
      const path = transform.target as Path;
      if (!isControlPoint) {
        if (!event.ctrlKey) {
          deselectPathControls();
        }
        selectedControls.push(control);
        const cps = controlPoints[commandIndexPos];
        if (cps) {
          cps.forEach(({ control: cp }) => {
            lastControlPoints.push(cp);
            cp.visible = true;
          });
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

  return controls;
}

export function deselectPathControls() {
  lastControlPoints.forEach((cp) => {
    cp.visible = false;
  });
  selectedControls.length = 0;
}
