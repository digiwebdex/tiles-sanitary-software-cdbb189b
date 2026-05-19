import { useQuery } from "@tanstack/react-query";
import { purchaseService, type PurchaseDraft } from "@/services/purchaseService";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface PurchaseDraftMenuProps {
  dealerId: string;
  onLoad: (draft: PurchaseDraft) => void;
}

const PurchaseDraftMenu = ({ dealerId, onLoad }: PurchaseDraftMenuProps) => {
  const { data: drafts = [], refetch } = useQuery({
    queryKey: ["purchase-drafts", dealerId],
    queryFn: () => purchaseService.listDrafts(dealerId),
    enabled: !!dealerId,
  });

  const handleDelete = async (id: string) => {
    try {
      await purchaseService.deleteDraft(dealerId, id);
      toast.success("Draft deleted");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete draft");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <FolderOpen className="h-4 w-4" />
          Drafts {drafts.length > 0 && `(${drafts.length})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Saved Drafts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {drafts.length === 0 ? (
          <DropdownMenuItem disabled>No drafts yet</DropdownMenuItem>
        ) : (
          drafts.map((d) => (
            <DropdownMenuItem
              key={d.id}
              onSelect={(e) => {
                e.preventDefault();
                onLoad(d);
              }}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate text-sm">{d.label || "Untitled draft"}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(d.updated_at).toLocaleString()}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(d.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PurchaseDraftMenu;
