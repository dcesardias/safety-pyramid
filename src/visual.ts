"use strict";

/// <reference path="./typings/d3.d.ts" />

import "core-js/stable";
import "./../style/visual.less";

import powerbi from "powerbi-visuals-api";
import { VisualSettings } from "./settings";
import * as d3 from "d3";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import DataView = powerbi.DataView;
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

// ─── Types ────────────────────────────────────────────────────────────────────
interface PyramidLevel {
    category: string;
    value: number;
    percentage: number;
    color: string;
    gradientId: string;
    selectionId: ISelectionId;
    index: number; // 0 = base (maior valor)
}

// ─── Default palette (base → topo) ───────────────────────────────────────────
const DEFAULT_COLORS: string[] = [
    "#1565C0",
    "#1976D2",
    "#F9A825",
    "#E64A19",
    "#B71C1C",
    "#6A1B9A",
    "#00695C",
    "#37474F",
    "#4E342E",
    "#263238",
];

// Locale pt-BR: ponto como milhar, vírgula como decimal
const ptBR = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["R$", ""] });

function formatValue(value: number, format: string, decimals: number): string {
    const d = Math.max(0, Math.round(decimals || 0));
    if (format === "abbreviated") {
        if (value >= 1_000_000) return ptBR.format(`,.${d}f`)(value / 1_000_000) + "M";
        if (value >= 1_000)     return ptBR.format(`,.${d}f`)(value / 1_000) + "K";
        return ptBR.format(`,.${d}f`)(value);
    }
    if (format === "none") {
        return ptBR.format(`.${d}f`)(value);
    }
    // "thousands" (padrão)
    return d === 0 ? ptBR.format(",d")(value) : ptBR.format(`,.${d}f`)(value);
}

// Extracts hex string from Power BI fill object or plain string
function extractColor(val: any, fallback: string): string {
    if (!val) { return fallback; }
    if (typeof val === "string") { return val; }
    if (val && val.solid && val.solid.color) { return val.solid.color; }
    return fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) { return { r: 128, g: 128, b: 128 }; }
    return {
        r: parseInt(clean.substring(0, 2), 16),
        g: parseInt(clean.substring(2, 4), 16),
        b: parseInt(clean.substring(4, 6), 16),
    };
}

function lighten(hex: string, amount: number): string {
    const c = hexToRgb(hex);
    const r = Math.min(255, c.r + Math.round(amount * 255));
    const g = Math.min(255, c.g + Math.round(amount * 255));
    const b = Math.min(255, c.b + Math.round(amount * 255));
    return `rgb(${r},${g},${b})`;
}

function darken(hex: string, amount: number): string {
    const c = hexToRgb(hex);
    const r = Math.max(0, Math.round(c.r * (1 - amount)));
    const g = Math.max(0, Math.round(c.g * (1 - amount)));
    const b = Math.max(0, Math.round(c.b * (1 - amount)));
    return `rgb(${r},${g},${b})`;
}

// ─── Visual ───────────────────────────────────────────────────────────────────
export class SafetyPyramid implements IVisual {
    private host: IVisualHost;
    private svg: any;
    private container: any;
    private defs: any;
    private selectionManager: ISelectionManager;
    private settings: VisualSettings;
    private tooltipDiv: any;
    private rootElement: HTMLElement;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.rootElement = options.element;
        this.selectionManager = this.host.createSelectionManager();
        this.selectionManager.registerOnSelectCallback(() => { /* required for context menu */ });

        this.svg = d3
            .select(options.element)
            .append("svg")
            .classed("safety-pyramid-svg", true)
            .style("overflow", "visible");

        this.defs = this.svg.append("defs");

        // Drop-shadow filter
        const filter = this.defs
            .append("filter")
            .attr("id", "levelShadow")
            .attr("x", "-8%")
            .attr("y", "-8%")
            .attr("width", "116%")
            .attr("height", "124%");
        filter.append("feDropShadow")
            .attr("dx", "0")
            .attr("dy", "2")
            .attr("stdDeviation", "3")
            .attr("flood-color", "rgba(0,0,0,0.22)");

        this.container = this.svg.append("g").classed("pyramid-container", true);

        // Context menu on empty area clears selection
        const self = this;
        this.svg.on("contextmenu", function(event: MouseEvent) {
            event.preventDefault();
            self.selectionManager.showContextMenu(
                null,
                { x: event.clientX, y: event.clientY }
            );
        });

        this.tooltipDiv = d3
            .select(options.element)
            .append("div")
            .classed("pyramid-tooltip", true)
            .style("opacity", 0)
            .style("position", "absolute")
            .style("pointer-events", "none");
    }

    // ── enumerateObjectInstances ─────────────────────────────────────────────
    public enumerateObjectInstances(
        options: EnumerateVisualObjectInstancesOptions
    ): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        return VisualSettings.enumerateObjectInstances(
            this.settings || VisualSettings.getDefault(),
            options
        );
    }

    // ── update ───────────────────────────────────────────────────────────────
    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        try {
        const dataView: DataView = options && options.dataViews && options.dataViews[0];
        if (!dataView || !dataView.categorical || !dataView.categorical.categories || !dataView.categorical.categories[0]) {
            this.container.selectAll("*").remove();
            this.host.eventService.renderingFinished(options);
            return;
        }

        this.settings = <VisualSettings>VisualSettings.parse(dataView);

        const width: number = options.viewport.width;
        const height: number = options.viewport.height;
        this.svg.attr("width", width).attr("height", height);

        // ── Parse & sort ─────────────────────────────────────────────────────
        const categorical = dataView.categorical;
        const catValues = categorical.categories[0].values;
        const measValues = (categorical.values && categorical.values[0]) ? categorical.values[0].values : [];

        const rawData: { category: string; value: number; selectionId: ISelectionId }[] = [];
        for (let i = 0; i < catValues.length; i++) {
            rawData.push({
                category: String(catValues[i] || ""),
                value: Number(measValues[i]) || 0,
                selectionId: this.host
                    .createSelectionIdBuilder()
                    .withCategory(categorical.categories[0], i)
                    .createSelectionId(),
            });
        }

        rawData.sort((a, b) => b.value - a.value); // descending → index 0 = base

        const total: number = d3.sum(rawData, d => d.value);
        const numLevels: number = rawData.length;

        const userColors: string[] = [
            extractColor(this.settings.colors.level1Color, DEFAULT_COLORS[0]),
            extractColor(this.settings.colors.level2Color, DEFAULT_COLORS[1]),
            extractColor(this.settings.colors.level3Color, DEFAULT_COLORS[2]),
            extractColor(this.settings.colors.level4Color, DEFAULT_COLORS[3]),
            extractColor(this.settings.colors.level5Color, DEFAULT_COLORS[4]),
        ];

        const getColor = (i: number): string =>
            userColors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length];

        const levels: PyramidLevel[] = rawData.map((d, i) => ({
            ...d,
            percentage: total > 0 ? (d.value / total) * 100 : 0,
            color: getColor(i),
            gradientId: `grad_sp_${i}`,
            index: i,
        }));

        // ── Layout ───────────────────────────────────────────────────────────
        const showLegend: boolean = this.settings.legend.show;
        const legendWidth: number = showLegend ? Math.min(220, width * 0.30) : 0;
        const marginH: number = 16;
        const marginV: number = 12;
        const pyramidAreaW: number = width - legendWidth - marginH;
        const pyramidAreaH: number = height - marginV * 2;

        const gap: number              = Math.max(0, this.settings.pyramid.gapBetweenLevels);
        const proportionalHeight: boolean = this.settings.pyramid.proportionalHeight;
        const labelsOutside: boolean   = this.settings.pyramid.labelsOutside;
        const inverted0: boolean       = this.settings.pyramid.invertPyramid;
        const show3D: boolean          = this.settings.pyramid.show3D;
        const depth3DPct: number       = Math.max(2, Math.min(25, this.settings.pyramid.depth3DPct || 12));

        // Largura bruta máxima (sem 3D)
        const rawMaxW: number          = labelsOutside ? pyramidAreaW * 0.48 : pyramidAreaW * 0.90;
        // Quando 3D, a face frontal é reduzida para a profundidade caber à direita
        const maxW: number             = show3D ? rawMaxW * 0.82 : rawMaxW;
        const minW: number             = labelsOutside ? pyramidAreaW * 0.04 : pyramidAreaW * 0.07;
        const pyramidCX: number        = labelsOutside ? pyramidAreaW * 0.27 : pyramidAreaW / 2;
        // x fixo onde a linha de chamada termina e o texto começa
        const labelLineX: number       = pyramidCX + maxW / 2 + (show3D ? rawMaxW * depth3DPct / 100 : 0) + 20;
        // Vetores de profundidade 3D (direita e levemente para cima)
        const dx3D: number             = show3D ? rawMaxW * depth3DPct / 100 : 0;
        const dy3D: number             = show3D ? -dx3D * 0.48 : 0;

        const totalAvailableH: number  = pyramidAreaH - gap * (numLevels - 1);

        // Pré-calcular a altura individual de cada linha visual (topIndex 0..N-1)
        const levelHeights: number[] = new Array(numLevels);
        if (proportionalHeight) {
            const minPct = Math.max(0.001, (this.settings.pyramid.minLevelHeightPct || 5) / 100);
            const maxPct = Math.min(0.999, (this.settings.pyramid.maxLevelHeightPct || 70) / 100);

            // 1. Calcular proporção bruta e aplicar clamp
            levels.forEach(lv => {
                const ti = inverted0 ? lv.index : numLevels - 1 - lv.index;
                const rawPct = total > 0 ? lv.value / total : 1 / numLevels;
                levelHeights[ti] = Math.min(maxPct, Math.max(minPct, rawPct));
            });
            // 2. Renormalizar para que a soma = 1, depois converter para px
            const sumPct = levelHeights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < numLevels; i++) {
                levelHeights[i] = Math.max(8, totalAvailableH * levelHeights[i] / sumPct);
            }
        } else {
            const uniformH = Math.max(20, totalAvailableH / numLevels);
            for (let i = 0; i < numLevels; i++) levelHeights[i] = uniformH;
        }

        // Posições y acumuladas por topIndex
        const yTops: number[] = new Array(numLevels);
        let cumY = 0;
        for (let i = 0; i < numLevels; i++) {
            yTops[i] = cumY;
            cumY += levelHeights[i] + gap;
        }

        // ── Rebuild gradients ─────────────────────────────────────────────────
        this.defs.selectAll("linearGradient").remove();

        levels.forEach(lv => {
            const grad = this.defs
                .append("linearGradient")
                .attr("id", lv.gradientId)
                .attr("x1", "0%").attr("y1", "0%")
                .attr("x2", "0%").attr("y2", "100%");
            grad.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", lighten(lv.color, 0.26));
            grad.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", lv.color);
        });

        // ── Draw ─────────────────────────────────────────────────────────────
        this.container.selectAll("*").remove();
        this.container.attr("transform", `translate(0,${marginV})`);

        const self = this;
        const valueFontSize: number    = this.settings.labels.valueFontSize;
        const catFontSize: number      = this.settings.labels.categoryFontSize;
        const showPct: boolean         = this.settings.labels.showPercentage;
        const inverted: boolean        = inverted0;
        const fontFamily: string       = this.settings.labels.fontFamily || "Segoe UI, sans-serif";
        const valueBold: string        = this.settings.labels.valueBold ? "700" : "400";
        const valueColor: string       = extractColor(this.settings.labels.valueColor, "#ffffff");
        const valueFormat: string      = this.settings.labels.valueFormat || "thousands";
        const valueDecimals: number    = Math.max(0, Math.round(this.settings.labels.valueDecimals || 0));
        const pctColor: string         = extractColor(this.settings.labels.percentageColor, "rgba(255,255,255,0.70)");
        const pctBold: string          = this.settings.labels.percentageBold ? "700" : "400";
        const pctDecimals: number      = Math.max(0, Math.round(this.settings.labels.percentageDecimals ?? 1));
        const categoryBold: string     = this.settings.labels.categoryBold ? "700" : "400";
        const categoryColor: string    = extractColor(this.settings.labels.categoryColor, "rgba(255,255,255,0.85)");

        if (show3D) {
            this.render3DPyramid(levels, levelHeights, yTops, pyramidAreaW, pyramidAreaH,
                                 numLevels, inverted, self, valueFormat, valueDecimals, pctDecimals);
        } else {
        levels.forEach(lv => {
            // Normal  : index 0 (maior valor) → linha de baixo (topIndex = numLevels-1)
            // Invertida: index 0 (maior valor) → linha de cima  (topIndex = 0)
            const topIndex: number = inverted ? lv.index : numLevels - 1 - lv.index;

            const thisH: number = levelHeights[topIndex];
            const y_top: number = yTops[topIndex];
            const y_bot: number = y_top + thisH;

            // Largura baseada na fração de y real (não no índice), para que o
            // contorno triangular seja mantido mesmo com alturas proporcionais.
            const yFracTop: number = y_top / pyramidAreaH;
            const yFracBot: number = y_bot / pyramidAreaH;
            let w_top: number;
            let w_bot: number;
            if (!inverted) {
                w_top = minW + (maxW - minW) * yFracTop;
                w_bot = minW + (maxW - minW) * yFracBot;
            } else {
                w_top = maxW - (maxW - minW) * yFracTop;
                w_bot = maxW - (maxW - minW) * yFracBot;
            }

            const xtl: number = pyramidCX - w_top / 2;
            const xtr: number = pyramidCX + w_top / 2;
            const xbl: number = pyramidCX - w_bot / 2;
            const xbr: number = pyramidCX + w_bot / 2;

            const pts: string = `${xtl},${y_top} ${xtr},${y_top} ${xbr},${y_bot} ${xbl},${y_bot}`;

            const levelG = this.container.append("g")
                .classed("pyramid-level", true)
                .style("cursor", "pointer");

            // ── Face frontal ─────────────────────────────────────────────────
            levelG.append("polygon")
                .attr("points", pts)
                .attr("fill", `url(#${lv.gradientId})`)
                .attr("stroke", "rgba(255,255,255,0.55)")
                .attr("stroke-width", 1.5)
                .attr("filter", "url(#levelShadow)");

            const cy: number = y_top + thisH / 2;
            const lineGap: number = 3;

            if (labelsOutside) {
                // ── Rótulos fora: linha de chamada + texto à direita ──────────
                // Ponto de origem: borda direita do trapézio na altura cy
                const wMid: number   = (w_top + w_bot) / 2;
                const xOrigin: number = pyramidCX + wMid / 2;

                // Linha de chamada
                levelG.append("line")
                    .attr("x1", xOrigin).attr("y1", cy)
                    .attr("x2", labelLineX).attr("y2", cy)
                    .attr("stroke", lv.color)
                    .attr("stroke-width", 1.5)
                    .attr("stroke-dasharray", "none")
                    .style("pointer-events", "none");

                // Pequeno ponto de ancoragem
                levelG.append("circle")
                    .attr("cx", xOrigin).attr("cy", cy).attr("r", 3)
                    .attr("fill", lv.color)
                    .style("pointer-events", "none");

                // Bloco de texto: 2 linhas
                // Linha 1: valor  ·  percentual%   (tspan para cores distintas)
                // Linha 2: categoria
                const oValSize = Math.min(valueFontSize, 16);
                const oCatSize = Math.min(catFontSize, 11);
                const oPctSize = oValSize;
                const oBlockH  = oValSize + lineGap + oCatSize;
                let   oY: number = cy - oBlockH / 2 + oValSize / 2;
                const tx: number = labelLineX + 6;

                // Linha 1
                const line1 = levelG.append("text")
                    .attr("x", tx).attr("y", oY)
                    .attr("text-anchor", "start").attr("dominant-baseline", "middle")
                    .style("font-family", fontFamily)
                    .style("pointer-events", "none");

                line1.append("tspan")
                    .style("font-size", `${oValSize}px`).style("font-weight", valueBold)
                    .style("fill", valueColor)
                    .text(formatValue(lv.value, valueFormat, valueDecimals));

                if (showPct) {
                    line1.append("tspan")
                        .style("font-size", `${oPctSize}px`).style("font-weight", pctBold)
                        .style("fill", pctColor)
                        .text(`  ·  ${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}%`);
                }

                // Linha 2: categoria
                oY += oValSize / 2 + lineGap + oCatSize / 2;
                levelG.append("text")
                    .attr("x", tx).attr("y", oY)
                    .attr("text-anchor", "start").attr("dominant-baseline", "middle")
                    .style("font-family", fontFamily)
                    .style("font-size", `${oCatSize}px`).style("font-weight", categoryBold)
                    .style("fill", categoryColor).style("pointer-events", "none")
                    .text(lv.category);

            } else {
                // ── Rótulos dentro do trapézio ────────────────────────────────
                const effectiveValueSize: number = Math.min(valueFontSize, thisH * 0.42);
                const effectiveCatSize: number   = Math.min(catFontSize,  thisH * 0.22);
                const effectivePctSize: number   = Math.min(catFontSize * 1.15, thisH * 0.24);
                const hasRoom: boolean = thisH > 34;

                const blockH: number = hasRoom
                    ? effectiveValueSize + lineGap
                      + (showPct ? effectivePctSize + lineGap : 0)
                      + effectiveCatSize
                    : effectiveValueSize;

                let curY: number = cy - blockH / 2 + effectiveValueSize / 2;

                levelG.append("text")
                    .attr("x", pyramidCX).attr("y", curY)
                    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                    .classed("level-value", true)
                    .style("font-family", fontFamily)
                    .style("font-size", `${effectiveValueSize}px`).style("font-weight", valueBold)
                    .style("fill", valueColor).style("text-shadow", "0 1px 4px rgba(0,0,0,0.45)")
                    .style("pointer-events", "none")
                    .text(formatValue(lv.value, valueFormat, valueDecimals));

                if (hasRoom) {
                    curY += effectiveValueSize / 2 + lineGap;

                    if (showPct) {
                        curY += effectivePctSize / 2;
                        levelG.append("text")
                            .attr("x", pyramidCX).attr("y", curY)
                            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                            .classed("level-pct", true)
                            .style("font-family", fontFamily)
                            .style("font-size", `${effectivePctSize}px`).style("font-weight", pctBold)
                            .style("fill", pctColor).style("pointer-events", "none")
                            .text(`${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}%`);
                        curY += effectivePctSize / 2 + lineGap;
                    }

                    curY += effectiveCatSize / 2;
                    levelG.append("text")
                        .attr("x", pyramidCX).attr("y", curY)
                        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                        .classed("level-category", true)
                        .style("font-family", fontFamily)
                        .style("font-size", `${effectiveCatSize}px`).style("font-weight", categoryBold)
                        .style("fill", categoryColor).style("pointer-events", "none")
                        .text(lv.category);
                }
            }

            // ── Event handlers (d3 v7: event as first param) ──────────────
            levelG
                .on("mouseover", function(_event: MouseEvent) {
                    d3.select(this).select("polygon")
                        .attr("stroke", "#fff")
                        .attr("stroke-width", 2.5)
                        .style("opacity", 0.88);

                    self.tooltipDiv.style("opacity", 1);
                    self.tooltipDiv.selectAll("*").remove();
                    self.tooltipDiv.append("div").classed("tt-title", true).text(lv.category);
                    self.tooltipDiv.append("div").classed("tt-value", true).text(formatValue(lv.value, valueFormat, valueDecimals));
                    self.tooltipDiv.append("div").classed("tt-pct", true).text(`${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}% do total`);
                })
                .on("mousemove", function(event: MouseEvent) {
                    const rect = self.rootElement.getBoundingClientRect();
                    self.tooltipDiv
                        .style("left", (event.clientX - rect.left + 14) + "px")
                        .style("top", (event.clientY - rect.top - 10) + "px");
                })
                .on("mouseout", function() {
                    d3.select(this).select("polygon")
                        .attr("stroke", "rgba(255,255,255,0.55)")
                        .attr("stroke-width", 1.5)
                        .style("opacity", 1);
                    self.tooltipDiv.style("opacity", 0);
                })
                .on("click", function() {
                    self.selectionManager.select(lv.selectionId, true);
                })
                .on("contextmenu", function(event: MouseEvent) {
                    event.preventDefault();
                    self.selectionManager.showContextMenu(
                        lv.selectionId,
                        { x: event.clientX, y: event.clientY }
                    );
                });
        });
        } // end if (!show3D)

        // ── Legend ───────────────────────────────────────────────────────────
        if (showLegend) {
            this.drawLegend(levels, pyramidAreaW + marginH, marginV, legendWidth - 4, pyramidAreaH);
        }

        // Signal rendering complete with all elements visible (for PDF export)
        this.container.selectAll(".pyramid-level").style("opacity", 1);
        this.host.eventService.renderingFinished(options);

        // Entrance animation — runs after export capture
        requestAnimationFrame(() => {
            this.container.selectAll(".pyramid-level")
                .style("opacity", 0)
                .transition()
                .duration(500)
                .delay((_d, i) => i * 70)
                .style("opacity", 1);
        });
        } catch (e) {
            this.host.eventService.renderingFailed(options, e.toString());
        }
    }

    // ── render3DPyramid ──────────────────────────────────────────────────────
    private render3DPyramid(
        levels: PyramidLevel[],
        levelHeights: number[],
        yTops: number[],
        areaW: number,
        areaH: number,
        numLevels: number,
        inverted: boolean,
        self: this,
        valueFormat: string,
        valueDecimals: number,
        pctDecimals: number
    ): void {
        const s           = this.settings;
        const outside     = s.pyramid.labelsOutside;
        const cx          = outside ? areaW * 0.34 : areaW / 2;
        const halfBase    = areaW * (outside ? 0.28 : 0.40);
        const depth3DPct  = Math.max(2, Math.min(25, s.pyramid.depth3DPct || 12));
        const depthY      = halfBase * depth3DPct * 0.035;
        const H           = areaH;
        const lineGap     = 3;
        const showPct     = s.labels.showPercentage;
        const fontFamily  = s.labels.fontFamily || "Segoe UI, sans-serif";
        const valueBold   = s.labels.valueBold ? "700" : "400";
        const valueColor  = extractColor(s.labels.valueColor, "#ffffff");
        const pctColor    = extractColor(s.labels.percentageColor, "rgba(255,255,255,0.70)");
        const pctBold     = s.labels.percentageBold ? "700" : "400";
        const catBold     = s.labels.categoryBold ? "700" : "400";
        const catColor    = extractColor(s.labels.categoryColor, "rgba(255,255,255,0.85)");
        const vSize       = s.labels.valueFontSize;
        const cSize       = s.labels.categoryFontSize;
        const labelLineX  = cx + halfBase + 22;

        // Projeção oblíqua: t=0 → base, t=1 → ápice
        const fp = (t: number) => ({ x: cx,                    y: H * (1 - t) });
        const lp = (t: number) => ({ x: cx - halfBase * (1-t), y: (H - depthY) * (1-t) });
        const rp = (t: number) => ({ x: cx + halfBase * (1-t), y: (H - depthY) * (1-t) });
        const pts4 = (a: {x:number,y:number}, b: {x:number,y:number},
                      c: {x:number,y:number}, d: {x:number,y:number}) =>
            `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`;

        levels.forEach(lv => {
            const topIndex = inverted ? lv.index : numLevels - 1 - lv.index;
            const tTop = 1 - yTops[topIndex] / H;
            const tBot = 1 - (yTops[topIndex] + levelHeights[topIndex]) / H;
            const tMid = (tTop + tBot) / 2;

            const FH = fp(tTop), FL = fp(tBot);
            const LH = lp(tTop), LL = lp(tBot);
            const RH = rp(tTop), RL = rp(tBot);

            const levelG = this.container.append("g")
                .classed("pyramid-level", true).style("cursor", "pointer");

            levelG.append("polygon")
                .attr("points", pts4(LH, FH, FL, LL))
                .attr("fill", darken(lv.color, 0.28))
                .attr("stroke", "rgba(255,255,255,0.20)").attr("stroke-width", 0.8);

            levelG.append("polygon")
                .attr("points", pts4(FH, RH, RL, FL))
                .attr("fill", `url(#${lv.gradientId})`)
                .attr("stroke", "rgba(255,255,255,0.35)").attr("stroke-width", 0.8);

            const fMid = fp(tMid);
            const rMid = rp(tMid);
            const bandHpx = Math.abs((H - depthY) * (tTop - tBot));

            if (outside) {
                const lx = rMid.x;
                const ly = rMid.y;
                levelG.append("line")
                    .attr("x1", lx).attr("y1", ly).attr("x2", labelLineX).attr("y2", ly)
                    .attr("stroke", lv.color).attr("stroke-width", 1.5)
                    .style("pointer-events", "none");
                levelG.append("circle")
                    .attr("cx", lx).attr("cy", ly).attr("r", 3)
                    .attr("fill", lv.color).style("pointer-events", "none");
                const oV = Math.min(vSize, 16), oC = Math.min(cSize, 11);
                const oP = oV;
                const tx = labelLineX + 6;
                let oY = ly - (oV + lineGap + oC) / 2 + oV / 2;
                const t1 = levelG.append("text")
                    .attr("x", tx).attr("y", oY)
                    .attr("text-anchor", "start").attr("dominant-baseline", "middle")
                    .style("font-family", fontFamily).style("pointer-events", "none");
                t1.append("tspan")
                    .style("font-size", `${oV}px`).style("font-weight", valueBold)
                    .style("fill", valueColor)
                    .text(formatValue(lv.value, valueFormat, valueDecimals));
                if (showPct) {
                    t1.append("tspan")
                        .style("font-size", `${oP}px`).style("font-weight", pctBold)
                        .style("fill", pctColor)
                        .text(`  ·  ${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}%`);
                }
                oY += oV / 2 + lineGap + oC / 2;
                levelG.append("text")
                    .attr("x", tx).attr("y", oY)
                    .attr("text-anchor", "start").attr("dominant-baseline", "middle")
                    .style("font-family", fontFamily)
                    .style("font-size", `${oC}px`).style("font-weight", catBold)
                    .style("fill", catColor).style("pointer-events", "none")
                    .text(lv.category);
            } else {
                const textX = (fMid.x + rMid.x) / 2;
                const textY = (fMid.y + rMid.y) / 2;
                const eV = Math.min(vSize, bandHpx * 0.40);
                const eC = Math.min(cSize, bandHpx * 0.20);
                const eP = Math.min(cSize * 1.1, bandHpx * 0.22);
                const hasRoom = bandHpx > 30;
                const blockH = hasRoom
                    ? eV + lineGap + (showPct ? eP + lineGap : 0) + eC : eV;
                let curY = textY - blockH / 2 + eV / 2;
                levelG.append("text")
                    .attr("x", textX).attr("y", curY)
                    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                    .style("font-family", fontFamily)
                    .style("font-size", `${eV}px`).style("font-weight", valueBold)
                    .style("fill", valueColor).style("pointer-events", "none")
                    .text(formatValue(lv.value, valueFormat, valueDecimals));
                if (hasRoom) {
                    curY += eV / 2 + lineGap;
                    if (showPct) {
                        curY += eP / 2;
                        levelG.append("text")
                            .attr("x", textX).attr("y", curY)
                            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                            .style("font-family", fontFamily)
                            .style("font-size", `${eP}px`).style("font-weight", pctBold)
                            .style("fill", pctColor).style("pointer-events", "none")
                            .text(`${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}%`);
                        curY += eP / 2 + lineGap;
                    }
                    curY += eC / 2;
                    levelG.append("text")
                        .attr("x", textX).attr("y", curY)
                        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                        .style("font-family", fontFamily)
                        .style("font-size", `${eC}px`).style("font-weight", catBold)
                        .style("fill", catColor).style("pointer-events", "none")
                        .text(lv.category);
                }
            }

            levelG
                .on("mouseover", function() {
                    d3.select(this).selectAll("polygon")
                        .attr("stroke", "#fff").attr("stroke-width", 1.5).style("opacity", 0.88);
                    self.tooltipDiv.style("opacity", 1);
                    self.tooltipDiv.selectAll("*").remove();
                    self.tooltipDiv.append("div").classed("tt-title", true).text(lv.category);
                    self.tooltipDiv.append("div").classed("tt-value", true).text(formatValue(lv.value, valueFormat, valueDecimals));
                    self.tooltipDiv.append("div").classed("tt-pct", true).text(`${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}% do total`);
                })
                .on("mousemove", function(event: MouseEvent) {
                    const rect = self.rootElement.getBoundingClientRect();
                    self.tooltipDiv
                        .style("left", (event.clientX - rect.left + 14) + "px")
                        .style("top",  (event.clientY - rect.top  - 10) + "px");
                })
                .on("mouseout", function() {
                    d3.select(this).selectAll("polygon")
                        .attr("stroke", "rgba(255,255,255,0.25)").attr("stroke-width", 0.8)
                        .style("opacity", 1);
                    self.tooltipDiv.style("opacity", 0);
                })
                .on("click", function() {
                    self.selectionManager.select(lv.selectionId, true);
                })
                .on("contextmenu", function(event: MouseEvent) {
                    event.preventDefault();
                    self.selectionManager.showContextMenu(
                        lv.selectionId,
                        { x: event.clientX, y: event.clientY }
                    );
                });
        });

        // Aresta central (divisória das duas faces)
        this.container.append("line")
            .attr("x1", cx).attr("y1", 0).attr("x2", cx).attr("y2", H)
            .attr("stroke", "rgba(255,255,255,0.55)").attr("stroke-width", 1.5)
            .style("pointer-events", "none");
    }

    // ── drawLegend ───────────────────────────────────────────────────────────
    private drawLegend(
        levels: PyramidLevel[],
        x: number,
        _y: number,
        _w: number,
        _h: number
    ): void {
        const legendG = this.container.append("g")
            .attr("transform", `translate(${x}, 0)`);

        const fs: number          = Math.max(10, this.settings.legend.fontSize);
        const showPct: boolean    = this.settings.labels.showPercentage;
        const valueFormat: string = this.settings.labels.valueFormat || "thousands";
        const valueDecimals       = Math.max(0, Math.round(this.settings.labels.valueDecimals || 0));
        const pctDecimals         = Math.max(0, Math.round(this.settings.labels.percentageDecimals ?? 1));
        // Altura por item: 2 linhas (categoria + valor/%) pedem mais espaço
        const itemH: number = showPct ? fs * 4.2 : fs * 3.0;

        legendG.append("text")
            .attr("x", 0).attr("y", 0)
            .style("font-size", `${fs + 1}px`)
            .style("font-weight", "700")
            .style("fill", "#333")
            .text(this.settings.legend.title || "Severidade");

        legendG.append("line")
            .attr("x1", 0).attr("y1", fs * 1.4)
            .attr("x2", 120).attr("y2", fs * 1.4)
            .attr("stroke", "#ddd")
            .attr("stroke-width", 1);

        // Topo (grave) first
        const items: PyramidLevel[] = levels.slice().reverse();

        items.forEach((lv, i) => {
            const gy: number = fs * 2.0 + i * itemH;
            const row = legendG.append("g").attr("transform", `translate(0,${gy})`);

            row.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", fs + 2).attr("height", fs + 2)
                .attr("rx", 3).attr("ry", 3)
                .attr("fill", lv.color);

            row.append("text")
                .attr("x", fs + 8).attr("y", fs)
                .style("font-size", `${fs}px`)
                .style("fill", "#222")
                .text(lv.category);

            if (showPct) {
                row.append("text")
                    .attr("x", fs + 8).attr("y", fs * 2.1)
                    .style("font-size", `${fs - 1}px`)
                    .style("fill", "#666")
                    .text(`${formatValue(lv.value, valueFormat, valueDecimals)}  ·  ${ptBR.format(`.${pctDecimals}f`)(lv.percentage)}%`);
            }
        });
    }
}
