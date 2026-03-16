import { dataViewObjectsParser } from "powerbi-visuals-utils-dataviewutils";
import DataViewObjectsParser = dataViewObjectsParser.DataViewObjectsParser;

// ─── Legend ───────────────────────────────────────────────────────────────────
export class LegendSettings {
    public show: boolean    = true;
    public title: string    = "Severidade";
    public fontSize: number = 12;
}

// ─── Labels ───────────────────────────────────────────────────────────────────
export class LabelsSettings {
    public showPercentage: boolean    = true;
    public fontFamily: string         = "Segoe UI, sans-serif";
    // Valor
    public valueFontSize: number      = 22;
    public valueBold: boolean         = true;
    public valueColor: string         = "#ffffff";
    // Formatação do valor: "thousands" | "abbreviated" | "none"
    public valueFormat: string        = "thousands";
    public valueDecimals: number      = 0;
    // Percentual
    public percentageBold: boolean    = false;
    public percentageColor: string    = "rgba(255,255,255,0.70)";
    public percentageDecimals: number = 1;
    // Categoria
    public categoryFontSize: number   = 11;
    public categoryBold: boolean      = false;
    public categoryColor: string      = "rgba(255,255,255,0.85)";
}

// ─── Colors ───────────────────────────────────────────────────────────────────
export class ColorsSettings {
    public level1Color: string = "#1565C0";
    public level2Color: string = "#388E3C";
    public level3Color: string = "#F9A825";
    public level4Color: string = "#E64A19";
    public level5Color: string = "#B71C1C";
}

// ─── Pyramid ──────────────────────────────────────────────────────────────────
export class PyramidSettings {
    public gapBetweenLevels: number   = 3;
    public borderRadius: number       = 4;
    public invertPyramid: boolean     = false;
    public proportionalHeight: boolean = false;
    // Limites de proporção mínima/máxima quando proportionalHeight está ativo
    public minLevelHeightPct: number  = 5;   // % mínima que cada nível pode ocupar
    public maxLevelHeightPct: number  = 70;  // % máxima que cada nível pode ocupar
    // Rótulos fora da pirâmide com linha de chamada
    public labelsOutside: boolean     = false;
    // Efeito 3D
    public show3D: boolean            = false;
    public depth3DPct: number         = 12;  // profundidade como % da largura máxima
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export class VisualSettings extends DataViewObjectsParser {
    public legend: LegendSettings = new LegendSettings();
    public labels: LabelsSettings = new LabelsSettings();
    public colors: ColorsSettings = new ColorsSettings();
    public pyramid: PyramidSettings = new PyramidSettings();
}
