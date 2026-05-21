CREATE UNIQUE INDEX IF NOT EXISTS purchases_dealer_invoice_unique
  ON public.purchases (dealer_id, invoice_number)
  WHERE invoice_number IS NOT NULL;