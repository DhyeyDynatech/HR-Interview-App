"use client";

import React from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ATSScoreResult } from "@/types/ats-scoring";
import { normalizeScore } from "@/components/dashboard/ats-scoring/atsResultCard";

interface ATSScoreChartProps {
  results: ATSScoreResult[];
}

function getBarColor(score: number) {
  const s = normalizeScore(score);
  if (s >= 7) return "#22c55e";
  if (s >= 4) return "#eab308";
  return "#ef4444";
}

export default function ATSScoreChart({ results }: ATSScoreChartProps) {
  if (results.length === 0) return null;

  const labels = results.map((r) =>
    r.resumeName.length > 20
      ? r.resumeName.substring(0, 17) + "..."
      : r.resumeName
  );
  const scores = results.map((r) => normalizeScore(r.overallScore));
  const colors = scores.map(getBarColor);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Candidate Ranking</CardTitle>
        <p className="text-sm text-slate-500">
          Overall ATS scores comparison
        </p>
      </CardHeader>
      <CardContent>
        <BarChart
          xAxis={[
            {
              scaleType: "band",
              data: labels,
              tickLabelStyle: {
                fontSize: 11,
                angle: results.length > 5 ? -30 : 0,
                textAnchor: results.length > 5 ? "end" : "middle",
              },
            },
          ]}
          yAxis={[
            {
              min: 0,
              max: 10,
              label: "ATS Score",
            },
          ]}
          series={[
            {
              data: scores,
              color: "#6366f1",
              label: "ATS Score",
            },
          ]}
          height={300}
          margin={{
            bottom: results.length > 5 ? 80 : 40,
            left: 50,
            right: 20,
            top: 20,
          }}
          slotProps={{
            legend: { hidden: true },
          }}
        />
      </CardContent>
    </Card>
  );
}
