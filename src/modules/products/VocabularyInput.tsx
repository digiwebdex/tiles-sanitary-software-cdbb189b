/**
 * VocabularyInput — V2 Sprint 2.1 (Product Master polish).
 *
 * A plain text input with a "controlled vocabulary" of suggestions attached
 * via the native HTML <datalist>. Picking a suggestion or typing a custom
 * value both work identically — this is deliberately NOT a hard enum: the
 * underlying column stays free-text varchar, so any value a dealer already
 * saved under Sprint 2 (or types that isn't in the list) remains valid.
 *
 * Drop-in replacement for <Input {...field} /> inside a react-hook-form
 * <FormField> — same props, just adds `suggestions`.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";

interface VocabularyInputProps extends React.ComponentProps<typeof Input> {
  suggestions: readonly string[];
  /** Unique id for the <datalist> — must be unique per field on the page. */
  listId: string;
}

const VocabularyInput = React.forwardRef<HTMLInputElement, VocabularyInputProps>(
  ({ suggestions, listId, ...inputProps }, ref) => {
    return (
      <>
        <Input ref={ref} list={listId} {...inputProps} />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </>
    );
  },
);
VocabularyInput.displayName = "VocabularyInput";

export default VocabularyInput;
