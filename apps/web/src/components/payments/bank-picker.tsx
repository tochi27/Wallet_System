import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useBanks } from "@/api/payments"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type BankPickerProps = {
  id?: string
  value: string | null
  onChange: (bankCode: string) => void
  invalid?: boolean
}

// Searchable list of the ~260 banks that can receive transfers
export function BankPicker({ id, value, onChange, invalid }: BankPickerProps) {
  const { data: banks, isPending, isError } = useBanks()
  const [open, setOpen] = useState(false)
  const selected = banks?.find((bank) => bank.code === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={isPending || isError}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : isPending ? "Loading banks…" : isError ? "Couldn't load banks" : "Choose a bank"}
          </span>
          <ChevronsUpDownIcon className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search banks…" />
          <CommandList>
            <CommandEmpty>No bank found.</CommandEmpty>
            <CommandGroup>
              {banks?.map((bank) => (
                <CommandItem
                  key={bank.code}
                  value={`${bank.name} ${bank.code}`}
                  onSelect={() => {
                    onChange(bank.code)
                    setOpen(false)
                  }}
                >
                  <CheckIcon className={cn(bank.code === value ? "opacity-100" : "opacity-0")} aria-hidden />
                  {bank.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
