// Minimal d3 type declarations compatible with TypeScript 3.8.x
// Uses only basic TypeScript syntax (no template literal types, no conditional types)

declare module "d3" {

    // ── Selection ────────────────────────────────────────────────────────────
    interface BaseSelection {
        // Structure
        append(type: string): BaseSelection;
        select(selector: any): BaseSelection;
        selectAll(selector: any): BaseSelection;
        remove(): BaseSelection;
        filter(selector: any): BaseSelection;
        clone(deep?: boolean): BaseSelection;
        // Attributes & styles
        attr(name: string): string;
        attr(name: string, value: any): BaseSelection;
        style(name: string): string;
        style(name: string, value: any, priority?: string): BaseSelection;
        classed(names: string): boolean;
        classed(names: string, value: boolean | ((d: any, i: number) => boolean)): BaseSelection;
        text(): string;
        text(value: any): BaseSelection;
        html(value?: any): BaseSelection;
        // Data
        datum(): any;
        datum(value: any): BaseSelection;
        data(data: any[], key?: any): BaseSelection;
        join(enter: any, update?: any, exit?: any): BaseSelection;
        // Events
        on(typenames: string): any;
        on(typenames: string, listener: ((event?: any, d?: any) => void) | null): BaseSelection;
        // Transition
        transition(name?: any): BaseTransition;
        interrupt(name?: string): BaseSelection;
        // Iteration
        each(func: (d: any, i: number, nodes: any) => void): BaseSelection;
        call(func: (selection: BaseSelection, ...args: any[]) => void, ...args: any[]): BaseSelection;
        empty(): boolean;
        node(): Element | null;
        nodes(): Element[];
        size(): number;
        // Raise / lower
        raise(): BaseSelection;
        lower(): BaseSelection;
        // Dispatcher
        dispatch(type: string, parameters?: any): BaseSelection;
    }

    // ── Transition ───────────────────────────────────────────────────────────
    interface BaseTransition {
        duration(ms: number | ((d: any, i: number) => number)): BaseTransition;
        delay(ms: number | ((d: any, i: number) => number)): BaseTransition;
        ease(ease: (t: number) => number): BaseTransition;
        attr(name: string, value: any): BaseTransition;
        style(name: string, value: any, priority?: string): BaseTransition;
        text(value: any): BaseTransition;
        remove(): BaseTransition;
        select(selector: any): BaseTransition;
        selectAll(selector: any): BaseTransition;
        each(func: (d: any, i: number) => void): BaseTransition;
        call(func: any, ...args: any[]): BaseTransition;
        end(): Promise<void>;
        on(typenames: string, listener?: any): BaseTransition;
    }

    // ── Type aliases for backwards compat ─────────────────────────────────
    type Selection<GElement, Datum, PElement, PDatum> = BaseSelection;
    type Transition<GElement, Datum, PElement, PDatum> = BaseTransition;

    // ── Core functions ────────────────────────────────────────────────────
    function select(selector: string | Element | Window | null): BaseSelection;
    function selectAll(selector: string | Element[] | null): BaseSelection;

    function sum(iterable: any, accessor?: any): number;
    function format(specifier: string): (n: number | { valueOf(): number }) => string;

    function transition(name?: string): BaseTransition;

    // Scales (for future use)
    function scaleLinear(): any;
    function scaleOrdinal(): any;
    function scaleBand(): any;

    // Colors
    function color(specifier: string): any;
    function rgb(r?: any, g?: number, b?: number, opacity?: number): any;
    function hsl(h?: any, s?: number, l?: number, opacity?: number): any;

    // Easing
    const easeCubicInOut: (t: number) => number;
    const easeLinear: (t: number) => number;
    const easeQuad: (t: number) => number;
}
