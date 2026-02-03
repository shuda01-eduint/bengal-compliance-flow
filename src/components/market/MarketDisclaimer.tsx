import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function MarketDisclaimer() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-6">
      <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-amber-500/5 transition-colors">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-amber-400">Important Disclaimer</span>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-amber-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-amber-500" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 text-sm text-amber-300/80 leading-relaxed">
            <p>
              This data is provided for informational purposes only and should not be considered as investment advice. 
              Stock prices may be delayed by 15 minutes. Past performance does not guarantee future results. 
              Always consult with a qualified financial advisor before making investment decisions. 
              Trading in securities involves risk and you may lose part or all of your investment.
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
