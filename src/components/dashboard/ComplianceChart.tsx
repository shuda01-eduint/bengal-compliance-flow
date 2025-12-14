import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const data = [
  { name: "Approved", value: 2, color: "hsl(142, 76%, 36%)" },
  { name: "Submitted", value: 2, color: "hsl(199, 89%, 48%)" },
  { name: "Pending", value: 2, color: "hsl(38, 92%, 50%)" },
  { name: "Revision", value: 1, color: "hsl(280, 65%, 60%)" },
  { name: "Overdue", value: 1, color: "hsl(0, 72%, 51%)" },
];

export function ComplianceChart() {
  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "200ms" }}>
      <h3 className="text-lg font-semibold font-serif text-foreground mb-4">Report Status Distribution</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={4}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(222, 47%, 10%)",
                border: "1px solid hsl(217, 33%, 20%)",
                borderRadius: "8px",
                color: "hsl(210, 40%, 96%)"
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => <span className="text-sm text-muted-foreground">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
