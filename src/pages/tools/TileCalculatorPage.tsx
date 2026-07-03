import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, RotateCcw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type AreaMode = "dimensions" | "area";
type Unit = "feet" | "meter" | "inch";

// Convert a length in the chosen unit to feet.
function toFeet(value: number, unit: Unit): number {
  if (unit === "meter") return value * 3.28084;
  if (unit === "inch") return value / 12;
  return value;
}

const TileCalculatorPage = () => {
  const [mode, setMode] = useState<AreaMode>("dimensions");
  const [unit, setUnit] = useState<Unit>("feet");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [directArea, setDirectArea] = useState("");
  const [wastage, setWastage] = useState("10");
  const [sftPerBox, setSftPerBox] = useState("");
  const [piecesPerBox, setPiecesPerBox] = useState("");
  const [pricePerBox, setPricePerBox] = useState("");

  const result = useMemo(() => {
    const num = (s: string) => (isNaN(Number(s)) ? 0 : Number(s));
    let areaSqft = 0;
    if (mode === "area") {
      areaSqft = num(directArea);
    } else {
      const l = toFeet(num(length), unit);
      const w = toFeet(num(width), unit);
      areaSqft = l * w;
    }
    const wastagePct = Math.max(0, num(wastage));
    const areaWithWastage = areaSqft * (1 + wastagePct / 100);
    const perBox = num(sftPerBox);
    const boxes = perBox > 0 ? Math.ceil(areaWithWastage / perBox) : 0;
    const ppb = num(piecesPerBox);
    const pieces = ppb > 0 ? boxes * ppb : 0;
    const boxPrice = num(pricePerBox);
    const cost = boxes * boxPrice;
    const coveredSft = boxes * perBox;
    return { areaSqft, areaWithWastage, boxes, pieces, cost, coveredSft, perBox };
  }, [mode, unit, length, width, directArea, wastage, sftPerBox, piecesPerBox, pricePerBox]);

  const reset = () => {
    setLength(""); setWidth(""); setDirectArea(""); setWastage("10");
    setSftPerBox(""); setPiecesPerBox(""); setPricePerBox("");
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <Link to="/sales" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Tile Calculator
          </CardTitle>
          <CardDescription>
            Work out how many boxes (and pieces) a customer needs for a given area — with wastage
            allowance and an optional price estimate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Area input */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "dimensions" ? "default" : "outline"} onClick={() => setMode("dimensions")}>
                Length × Width
              </Button>
              <Button size="sm" variant={mode === "area" ? "default" : "outline"} onClick={() => setMode("area")}>
                I know total area (sft)
              </Button>
            </div>

            {mode === "dimensions" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="len">Length</Label>
                  <Input id="len" type="number" inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} placeholder="e.g. 12" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wid">Width</Label>
                  <Input id="wid" type="number" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="e.g. 10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="unit">Unit</Label>
                  <select
                    id="unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="feet">Feet</option>
                    <option value="meter">Meter</option>
                    <option value="inch">Inch</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 max-w-[240px]">
                <Label htmlFor="area">Total area (sft)</Label>
                <Input id="area" type="number" inputMode="decimal" value={directArea} onChange={(e) => setDirectArea(e.target.value)} placeholder="e.g. 120" />
              </div>
            )}
          </div>

          {/* Tile spec */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="wastage">Wastage %</Label>
              <Input id="wastage" type="number" inputMode="decimal" value={wastage} onChange={(e) => setWastage(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sftbox">SFT / box</Label>
              <Input id="sftbox" type="number" inputMode="decimal" value={sftPerBox} onChange={(e) => setSftPerBox(e.target.value)} placeholder="e.g. 24" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppb">Pcs / box</Label>
              <Input id="ppb" type="number" inputMode="numeric" value={piecesPerBox} onChange={(e) => setPiecesPerBox(e.target.value)} placeholder="e.g. 6" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Price / box (৳)</Label>
              <Input id="price" type="number" inputMode="decimal" value={pricePerBox} onChange={(e) => setPricePerBox(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>

          {/* Result */}
          <div className="rounded-lg border bg-muted/40 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Metric label="Area" value={`${result.areaSqft.toFixed(2)} sft`} />
            <Metric label={`+ ${wastage || 0}% wastage`} value={`${result.areaWithWastage.toFixed(2)} sft`} />
            <Metric label="Boxes needed" value={result.boxes ? String(result.boxes) : "—"} highlight />
            <Metric label="Pieces" value={result.pieces ? String(result.pieces) : "—"} />
            {result.perBox > 0 && (
              <Metric label="Covers" value={`${result.coveredSft.toFixed(2)} sft`} />
            )}
            {result.cost > 0 && (
              <Metric label="Est. cost" value={formatCurrency(result.cost)} highlight />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Boxes are always rounded up. Enter “SFT / box” from the product to get box counts;
            add “Price / box” for a quick quote.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

const Metric = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`font-semibold ${highlight ? "text-primary text-lg" : "text-foreground"}`}>{value}</p>
  </div>
);

export default TileCalculatorPage;
