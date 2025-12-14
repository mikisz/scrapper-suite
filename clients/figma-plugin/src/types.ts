/// <reference types="@figma/plugin-typings" />

/**
 * Shared type definitions for the Website-to-Figma plugin
 */

// Component-docs mode metadata
export interface ComponentDocsMetadata {
    pageTitle: string;
    libraryDetected: string | null;
    totalComponentsFound: number;
    themeApplied: string;
}

export interface ComponentDocsDoneSummary {
    type: 'done';
    mode: 'component-docs';
    stats: {
        totalNodes: number;
        totalComponents: number;
        imagesLoaded: number;
        totalImages: number;
    };
    metadata: ComponentDocsMetadata;
    warnings?: string[];
}

// Visual tree node styles
export interface VisualNodeStyles {
    width?: number;
    height?: number;
    position?: 'absolute' | 'fixed' | 'relative' | 'static';
    top?: number;
    left?: number;
    display?: 'flex' | 'grid' | 'block' | 'inline' | 'inline-flex' | 'inline-block' | 'none';
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
    flexGrow?: number;
    alignItems?: string;
    alignSelf?: string;
    justifyContent?: string;
    gap?: number;
    rowGap?: number;
    columnGap?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
    margin?: { top: number; right: number; bottom: number; left: number };
    backgroundColor?: RGBA;
    backgroundImage?: {
        type: 'IMAGE' | 'GRADIENT';
        url?: string;
        raw?: string;
        size?: string;
    };
    backgroundRepeat?: string;
    color?: RGBA;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string | number;
    fontStyle?: string;
    lineHeight?: string;
    letterSpacing?: number;
    textAlign?: string;
    textTransform?: string;
    textDecoration?: string;
    textShadow?: string;
    boxShadow?: string;
    border?: {
        width: number;
        color: RGBA;
        style?: string;
    };
    borderRadius?: {
        topLeft: number;
        topRight: number;
        bottomRight: number;
        bottomLeft: number;
    };
    overflowX?: string;
    overflowY?: string;
    opacity?: number;
    transform?: string;
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
    gridColumn?: string;
    gridColumnStart?: string;
}

// Visual tree node from dom-serializer
export interface VisualNode {
    type: 'FRAME' | 'TEXT_NODE' | 'TEXT' | 'IMAGE' | 'VECTOR' | 'PSEUDO_ELEMENT';
    tag?: string;
    name?: string;
    content?: string;
    src?: string;
    svgString?: string;
    svgFill?: RGBA;
    viewBox?: string;
    objectFit?: string;
    pseudo?: '::before' | '::after';
    contentType?: 'TEXT' | 'IMAGE' | 'GRADIENT' | 'NONE';
    imageUrl?: string;
    styles?: VisualNodeStyles;
    children?: VisualNode[];
    globalBounds?: { x: number; y: number; width: number; height: number };
    // Internal grid info (added during processing)
    _gridInfo?: GridInfo;
}

// Grid parsing info
export interface GridInfo {
    columns: number;
    tracks: GridTrack[];
    containerWidth: number;
    columnGap: number;
    rowGap: number;
}

export interface GridTrack {
    value: number;
    unit: 'px' | 'fr' | 'auto' | 'minmax';
}

export interface GridTrackInfo {
    count: number;
    tracks: GridTrack[];
    hasAutoFit: boolean;
    hasAutoFill: boolean;
}

export interface GridSpanInfo {
    start: number;
    span: number;
}

// Component data for component-docs mode
export interface ComponentData {
    name: string;
    variant?: string;
    tree: VisualNode;
    bounds: { x: number; y: number; width: number; height: number };
}

// Build message types
export interface BuildMessage {
    type: 'build';
    data: VisualNode;
}

export interface BuildComponentsMessage {
    type: 'build-components';
    data: {
        components: ComponentData[];
        metadata: ComponentDocsMetadata;
    };
}

export interface ImageDataMessage {
    type: 'image-data';
    id: string;
    data?: Uint8Array;
    error?: boolean;
}

export type PluginMessage = BuildMessage | BuildComponentsMessage | ImageDataMessage;
