import { useCurrentSlide } from "@/hooks/useCurrentSlide";
import useModKeyDown from "@/hooks/useModKeyDown";
import useShiftKeyDown from "@/hooks/useShiftKeyDown";
import {getMediaContainerDomId, getMediaContainerElement, getMediaContentElement} from "player/media-container-helper";
import Moveable, {
  type OnScaleEnd,
  type OnDragEnd,
  type OnResizeEnd,
  type OnRoundEnd,
  type OnResize,
  type OnDrag,
  type OnResizeStart,
} from "react-moveable";
import _merge from "lodash/merge";
import { canvasEditorManager, useCanvasEditorSnapshot } from "./canvas-editor-manager";
import { useState, useRef, useEffect } from "react";
import { useEventHandler } from "@/hooks/useEventHandler";
import { slideBorderManager } from "slide-borders/slide-border-manager";
import {
  isSlideMediaElement,
  isSlideTextElement,
  type UUID,
  type SlideElement,
  type SlideTextElement,
} from "@/types/models";
import { store, useFromState } from "@/redux/store";
import { selectActiveAnimation } from "animation-engine/selectors/select-active-animation";
import { getMediaContentStylesV2 } from "media-container-styles/get-media-content-styles";
import { toDecimal } from "math-utils/math-utils";
import { useForceUpdate } from "@mantine/hooks";
import { textEditorManager } from "text/text-editor-manager";
import { getNormalizedFontSize, getPxFontSize, TEXT_EDITOR_PADDING } from "text/text-helpers";
import { textEditorSlice } from "@/redux/slices/text-editor";
import { selectCanvasDimensions } from "./selectors/select-canvas-dimensions";
import { selectIsPlaying } from "@/redux/selectors/select-is-playing";
import { useSelector } from "react-redux";
import { selectIsCropping } from "@/redux/selectors/select-is-cropping";

const resizerDirectionsToRender = [
  "nw",
  "ne",
  "sw",
  "se",
  // left/right edges
  "w",
  "e",
];

export type TransformerEvent = OnResizeEnd | OnRoundEnd | OnDragEnd | OnScaleEnd; // the three events we support

export type TransformerEditActionType = "radius" | "resize" | "drag" | "inner-drag" | "inner-resize" | "scale" | "crop";

export type HandleTransformerAction = (
  event: TransformerEvent,
  actionType: TransformerEditActionType,
  elementId: UUID,
  newNormalizedFontSize?: number, // note: this is only used for text elements, if we have time we should find a cleaner way to integrate this.
) => Promise<void>;

interface CanvasEditorResizerProps {
  handleTransformerAction: HandleTransformerAction;
}

const Transformer = ({ handleTransformerAction }: CanvasEditorResizerProps) => {
  const { canvasWidth, canvasHeight } = useFromState(selectCanvasDimensions);
  const currentSlideSnapshot = useCurrentSlide();
  const canvasEditorSnapshot = useCanvasEditorSnapshot();
  const forceUpdate = useForceUpdate();
  const lastFontSizeMap = useRef<Map<UUID, number>>(new Map());
  const originalWidthMap = useRef<Map<UUID, number>>(new Map());
  const moveableRef = useRef<Moveable>(null);
  const [keepRatio, setKeepRatio] = useState(true);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const isPlaying = useFromState(selectIsPlaying);
  const allElements = currentSlideSnapshot.elements;

  const shiftKeyDown = useShiftKeyDown(); // note these are just experimental at the moment
  const modKeyDown = useModKeyDown(); // note these are just experimental at the moment

  const selectedElements = currentSlideSnapshot.elements.filter((el) =>
    canvasEditorSnapshot.selectedElementIds.includes(el.uuid),
  );

  const selectedElementMediaContainers = selectedElements.map((element) => getMediaContainerElement(element.uuid));
  const [hideResizer, setHideResizer] = useState(false);
  const mediaContentRef = useRef<HTMLDivElement | null>(null);

  const isCropping = useSelector(selectIsCropping);
  const [clipPath, setClipPath] = useState<string>(''); // State to manage the clipPath


  useEffect(() => {
    console.log("selectedElements", selectedElements)
    if (selectedElements.length > 0) {
      const mediaContentNode = getMediaContentElement(selectedElements[0].uuid);
      console.log("mediaContentNode", mediaContentNode);
      if (mediaContentNode) {
        mediaContentRef.current = mediaContentNode;
      }
    }
  }, [selectedElements]);


  useEffect(() => {
    if (isCropping && mediaContentRef.current) {
      setClipPath('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'); // Full area by default
    }
  }, [isCropping]);

  // Apply the clipPath to the media element
  useEffect(() => {
    if (mediaContentRef.current) {
      mediaContentRef.current.style.clipPath = clipPath;
    }
  }, [clipPath]);

  const handleClipResize = (e: OnResize) => {
    const target = e.target as HTMLDivElement;

    // Bounding box of the media container
    const mediaBounds = mediaContentRef.current?.getBoundingClientRect();
    if (!mediaBounds) return;

    // New width/height and position of the crop area
    const { left, top } = e.drag;
    const { width, height } = target.getBoundingClientRect();

    // Calculate clipPath based on relative position/size within the container
    const leftPercent = ((left - mediaBounds.left) / mediaBounds.width) * 100;
    const topPercent = ((top - mediaBounds.top) / mediaBounds.height) * 100;
    const rightPercent = ((left + width - mediaBounds.left) / mediaBounds.width) * 100;
    const bottomPercent = ((top + height - mediaBounds.top) / mediaBounds.height) * 100;

    // Update clipPath to reflect the resized area
    setClipPath(
      `polygon(${leftPercent}% ${topPercent}%, ${rightPercent}% ${topPercent}%, ${rightPercent}% ${bottomPercent}%, ${leftPercent}% ${bottomPercent}%)`
    );
  };

  const handleClipDrag = (e: OnDrag) => {
    const mediaBounds = mediaContentRef.current?.getBoundingClientRect();
    if (!mediaBounds) return;

    const { left, top } = e.target.getBoundingClientRect();

    setClipPath((prevClipPath) => {
      const match = prevClipPath.match(
        /polygon\(([\d.]+)% ([\d.]+)%, ([\d.]+)% ([\d.]+)%, ([\d.]+)% ([\d.]+)%, ([\d.]+)% ([\d.]+)%\)/
      );

      if (!match) return prevClipPath;

      const [_, x1, y1, x2, y2, x3, y3, x4, y4] = match.map(parseFloat);

      const dxPercent = ((left - mediaBounds.left) / mediaBounds.width) * 100 - x1;
      const dyPercent = ((top - mediaBounds.top) / mediaBounds.height) * 100 - y1;

      return `polygon(
        ${x1 + dxPercent}% ${y1 + dyPercent}%,
        ${x2 + dxPercent}% ${y2 + dyPercent}%,
        ${x3 + dxPercent}% ${y3 + dyPercent}%,
        ${x4 + dxPercent}% ${y4 + dyPercent}%
      )`;
    });
  };

  useEventHandler("canvas-editor/hideResizer", () => {
    setHideResizer(true);
  });

  useEventHandler("canvas-editor/showResizer", () => {
    setHideResizer(false);
  });

  useEventHandler("canvas-editor/updateResizer", () => {
    forceUpdate();
    moveableRef.current?.updateRect();
  });

  const activeAnimation = useFromState((state) => selectActiveAnimation(state));

  // here the user is resizing the width of the text element, so we do not change the font size
  const handleTextWidthResize = (e: OnResize, element: SlideTextElement) => {
    const editor = textEditorManager.getTextEditorForElement(element);

    const pixelFontSize = getPxFontSize(element.fontSize, canvasWidth, canvasHeight);
    lastFontSizeMap.current.set(element.uuid, pixelFontSize);
    if (editor) {
      const contentHeight = toDecimal(editor.view.dom.getBoundingClientRect().height)
        .plus(2 * TEXT_EDITOR_PADDING)
        .toNumber();

      // reset the height to auto so it can adjust to the new content
      e.target.style.height = "auto";
    }
  };

  const handleTextFontResize = (e: OnResize, element: SlideTextElement) => {
    const textEditor = textEditorManager.getTextEditorForElement(element);
    if (!textEditor) return;
    const currentNormalizedFontSize = element.fontSize;
    const currentFontSizePx = getPxFontSize(currentNormalizedFontSize, canvasWidth, canvasHeight);

    const newWidth = toDecimal(e.width)
      .minus(2 * TEXT_EDITOR_PADDING)
      .toNumber(); // 2 x to account for left + right padding

    const newFontSizePx = toDecimal(newWidth)
      .times(toDecimal(currentFontSizePx).dividedBy(originalWidthMap.current.get(element.uuid) || 0))
      .toNumber();

    e.target.style.transformOrigin = "bottom left";

    if (textEditor.view.dom.parentElement) {
      textEditor.view.dom.parentElement.style.fontSize = `${newFontSizePx}px`;
    }

    lastFontSizeMap.current.set(element.uuid, newFontSizePx);

    // reset the height to auto so it can adjust to the new content
    e.target.style.height = "auto";
  };

  const handleTextResize = (e: OnResize, element: SlideTextElement) => {
    if (keepRatio) {
      handleTextFontResize(e, element);
    } else {
      handleTextWidthResize(e, element);
    }
  };

  const handleResize = (e: OnResize, element: SlideElement) => {
    const isTextElement = isSlideTextElement(element);
    // todo - break this out into a separate function
    if (!element) return;

    // all other elements resize normally
    e.target.style.width = `${e.width}px`;
    e.target.style.height = `${e.height}px`;
    e.target.style.transform = e.transform;

    if (isTextElement) {
      handleTextResize(e, element);
      return;
    }
    // here we need to update the border radius so it can keep its proportions as the element size changes
    const smallestContainerDimension = Math.min(e.width, e.height);
    const borderRadiusPx = slideBorderManager.getBorderRadiusPx(smallestContainerDimension, element.border.radius);

    e.target.style.borderRadius = `${borderRadiusPx}px`;

    const canvasRect = e.target.parentElement?.getBoundingClientRect();
    if (!canvasRect) return;

    const innerElement = e.target.children[0] as HTMLDivElement;
    if (!innerElement) return;

    const normalizedWidth = toDecimal(e.width).dividedBy(canvasRect.width).toNumber();
    const normalizedHeight = toDecimal(e.height).dividedBy(canvasRect.height).toNumber();

    const innerStyle = getMediaContentStylesV2({
      canvasDimensions: { width: canvasRect.width, height: canvasRect.height },
      element: {
        ...element,
        containerWidth: normalizedWidth,
        containerHeight: normalizedHeight,
      },
      containerDimensions: {
        width: e.offsetWidth,
        height: e.offsetHeight,
      },
    });
    _merge(innerElement.style, innerStyle);
  };

  function handleDrag(e: OnDrag, element: SlideElement) {
    e.target.style.transform = e.transform;
  }

  const handleDragEnd = async (e: OnDragEnd, element: SlideElement): Promise<void> => {
    // this only fires if single element is selected
    await handleTransformerAction(e, modKeyDown ? "inner-drag" : "drag", element.uuid);
  };

  const handleResizeStart = (e: OnResizeStart, element: SlideElement) => {
    const edgeDirection = 0; // 1,0,-1 for left/middle/right and top/middle/bottom
    if (e.direction.includes(edgeDirection)) {
      setKeepRatio(false);
    } else {
      if (isSlideTextElement(element)) {
        // always keep ratio for text elements corner resizing
        setKeepRatio(true);
      } else {
        // if shift key is down, ratio is UNlocked
        setKeepRatio(!shiftKeyDown);
      }
    }

    originalWidthMap.current.set(element.uuid, e.target.clientWidth);
  };
  const handleResizeEnd = (e: OnResizeEnd, element: SlideElement): void => {
    const isTextElement = isSlideTextElement(element);
    const pixelFontSize = lastFontSizeMap.current.get(element.uuid) || 0;
    const normalizedFontSize = getNormalizedFontSize(pixelFontSize, canvasWidth, canvasHeight);

    handleTransformerAction(e, "resize", element.uuid, normalizedFontSize);
    if (isTextElement && normalizedFontSize != null) {
      store.dispatch(textEditorSlice.actions.setSelectedNormalizedFontSize(normalizedFontSize));
    }
  };

  const isRoundable =
    selectedElements.length === 1 && selectedElements.every((el) => isSlideMediaElement(el) && !el.isLocked);

  const isResizable = true;

  const firstSelectedElement = selectedElements[0];

  useEffect(() => {
    if (!moveableRef.current) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      if (moveableRef.current && canvasEditorManager.snapshot.selectedElementIds.length > 0) {
        moveableRef.current.updateRect();
      }
    });

    for (const container of selectedElementMediaContainers) {
      if (container) {
        resizeObserverRef.current?.observe(container);
      }
    }

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [selectedElementMediaContainers]);

  if (!selectedElements.length || (activeAnimation && selectedElements.some((el) => !isSlideTextElement(el)))) {
    return <></>;
  }

  const shouldSnapBounds = false;
  const allElementsNotSelected = allElements.filter((el) => !canvasEditorSnapshot.selectedElementIds.includes(el.uuid));

  return (
    <Moveable
      ref={isPlaying ? null : moveableRef}
      target={isCropping ? mediaContentRef.current : selectedElementMediaContainers}
      hideChildMoveableDefaultLines={false}
      throttleDrag={1}
      edgeDraggable={false}
      startDragRotate={0}
      throttleDragRotate={0}
      resizable={isResizable}
      keepRatio={keepRatio}
      throttleResize={1}
      renderDirections={resizerDirectionsToRender}
      draggable={true}
      onDragGroup={({ events }) => {
        for (const ev of events) {
          const slideElement = selectedElements.find((el) =>
            ev.target.classList.contains(getMediaContainerDomId(el.uuid)),
          );
          if (!slideElement) {
            console.error("slideElement not found for", ev.target);
            continue;
          }
          handleDrag(ev, slideElement);
        }
      }}
      onDragGroupEnd={({ events }) => {
        for (const ev of events) {
          const slideElement = selectedElements.find((el) =>
            ev.target.classList.contains(getMediaContainerDomId(el.uuid)),
          );
          if (!slideElement) {
            console.error("slideElement not found for", ev.target);
            continue;
          }
          handleDragEnd(ev, slideElement);
        }
      }}
      onResizeGroupStart={({ events }) => {
        for (const ev of events) {
          const slideElement = selectedElements.find((el) =>
            ev.target.classList.contains(getMediaContainerDomId(el.uuid)),
          );
          if (!slideElement) {
            console.error("slideElement not found for", ev.target);
            continue;
          }
          handleResizeStart(ev, slideElement);
        }
      }}
      onResizeGroup={({ events }) => {
        for (const ev of events) {
          const slideElement = selectedElements.find((el) =>
            ev.target.classList.contains(getMediaContainerDomId(el.uuid)),
          );
          if (!slideElement) {
            console.error("slideElement not found for", ev.target);
            continue;
          }
          handleResize(ev, slideElement);
        }
      }}
      onResizeGroupEnd={({ events }) => {
        for (const ev of events) {
          const slideElement = selectedElements.find((el) =>
            ev.target.classList.contains(getMediaContainerDomId(el.uuid)),
          );
          if (!slideElement) {
            console.error("slideElement not found for", ev.target);
            continue;
          }
          handleResizeEnd(ev, slideElement);
        }
      }}
      onDrag={(e) => {
        if (isCropping) {
          handleClipDrag(e); // Define this function to adjust crop boundaries
        } else {
          handleDrag(e, firstSelectedElement);
        }
      }}
      onResize={(e) => {
        if (isCropping) {
          handleClipResize(e); // Define this function to resize the crop area
        } else {
          // this only fires if single element is selected
          handleResize(e, firstSelectedElement);
        }
      }}
      // dragging
      onDragEnd={(e) => handleDragEnd(e, firstSelectedElement)}
      // resizing
      onResizeStart={(e) => handleResizeStart(e, firstSelectedElement)}
      onResizeEnd={(e) => handleResizeEnd(e, firstSelectedElement)}
      // rounding
      roundable={isRoundable}
      onRound={(e) => {
        e.target.style.borderRadius = e.borderRadius;
      }}
      onRoundEnd={(e) => {
        handleTransformerAction(e, "radius", firstSelectedElement.uuid);
      }}
      snappable={true}
      elementGuidelines={shiftKeyDown ? [] : allElementsNotSelected.map((el) => `#${getMediaContainerDomId(el.uuid)}`)}
      isDisplaySnapDigit={true}
      maxSnapElementGuidelineDistance={100}
      isDisplayInnerSnapDigit={false}
      snapGap={false}
      // this controls the distance at which the snap will occur
      snapThreshold={shiftKeyDown ? 0 : 10}
      snapDirections={{
        top: true,
        left: true,
        bottom: true,
        right: true,
        center: true,
        middle: true,
      }}
      elementSnapDirections={{
        // middle: true,
        // center: true,
        top: true,
        left: true,
        bottom: true,
        right: true,
      }}
      verticalGuidelines={[0, ...(modKeyDown ? [] : [canvasWidth * 0.5, canvasWidth - 0.5]), canvasWidth]}
      horizontalGuidelines={[0.5, ...(modKeyDown ? [] : [canvasHeight * 0.5, canvasHeight - 0.5]), canvasHeight]}
      // // hide the guide dimension values
      snapDistFormat={(v, type) => ""}
      // Note; you cannot use this when passing a ref to moveable
      // useAccuratePosition={true}
      bounds={
        shouldSnapBounds
          ? {
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              position: "css",
            }
          : {}
      }
    />
  );
};

export default Transformer;
