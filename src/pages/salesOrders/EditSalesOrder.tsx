import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import SalesOrderForm from "@/modules/salesOrders/SalesOrderForm";
import { salesOrderService } from "@/services/salesOrderService";

const EditSalesOrder = () => {
  const { id } = useParams<{ id: string }>();

  const { data: salesOrder, isLoading } = useQuery({
    queryKey: ["sales-order", id],
    queryFn: () => salesOrderService.getById(id!),
    enabled: !!id,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["sales-order-items", id],
    queryFn: () => salesOrderService.listItems(id!),
    enabled: !!id,
  });

  if (isLoading || !salesOrder) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <SalesOrderForm initialOrder={salesOrder} initialItems={items} />
    </div>
  );
};

export default EditSalesOrder;
