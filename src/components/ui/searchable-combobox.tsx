import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  /** Extra searchable tokens (state, portal type, short name, etc.) */
  keywords?: string;
  /** Optional secondary line under the label */
  description?: string;
  /** Optional trailing content (e.g. badges) */
  meta?: React.ReactNode;
}

interface SearchableComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  /** data-testid for the trigger button */
  "data-testid"?: string;
  listClassName?: string;
}

function optionSearchText(option: ComboboxOption): string {
  return [option.label, option.value, option.keywords, option.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function SearchableCombobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  disabled = false,
  "data-testid": testId,
  listClassName,
}: SearchableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedOption = options.find((option) => option.value === value);

  const filteredOptions = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => optionSearchText(option).includes(query));
  }, [options, search]);

  // Group filtered options by their group property
  const groupedOptions = React.useMemo(() => {
    const groups: Record<string, ComboboxOption[]> = {};
    filteredOptions.forEach((option) => {
      const group = option.group || "Other";
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(option);
    });
    return groups;
  }, [filteredOptions]);

  const hasGroups =
    Object.keys(groupedOptions).length > 1 ||
    (Object.keys(groupedOptions).length === 1 && !groupedOptions["Other"]);

  React.useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  const renderOption = (option: ComboboxOption) => (
    <CommandItem
      key={option.value}
      value={optionSearchText(option)}
      onSelect={() => {
        onValueChange(option.value);
        setOpen(false);
      }}
      data-testid={testId ? `${testId}-option-${option.value}` : undefined}
    >
      <Check
        className={cn(
          "mr-2 h-4 w-4 shrink-0",
          value === option.value ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate">{option.label}</div>
          {option.description ? (
            <div className="truncate text-xs text-muted-foreground">{option.description}</div>
          ) : null}
        </div>
        {option.meta ? <div className="flex shrink-0 items-center gap-1">{option.meta}</div> : null}
      </div>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
          data-testid={testId}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] p-0 bg-popover"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={16}
        avoidCollisions
      >
        <Command shouldFilter={false} className="bg-popover">
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList
            className={cn(
              "max-h-64 overflow-y-auto overscroll-contain",
              listClassName,
            )}
            onWheel={(event) => {
              // Keep wheel/trackpad scroll inside the results panel (not the modal body).
              event.stopPropagation();
            }}
          >
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground" role="status">
                {emptyText}
              </div>
            ) : hasGroups ? (
              Object.entries(groupedOptions).map(([group, items]) => (
                <CommandGroup key={group} heading={group}>
                  {items.map(renderOption)}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>{filteredOptions.map(renderOption)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
