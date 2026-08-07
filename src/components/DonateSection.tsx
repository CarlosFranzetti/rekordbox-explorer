import { useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, Heart, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

/** One tap opens the payment page; the QR is there for handing someone a phone. */
const METHODS = [
  {
    id: 'paypal',
    label: 'PayPal',
    handle: 'paypal.me/losfiesta',
    url: 'https://paypal.me/losfiesta',
    className: 'bg-[#0070ba] text-white hover:bg-[#005ea6]',
  },
  {
    id: 'cashapp',
    label: 'Cash App',
    handle: '$hypedrum',
    url: 'https://cash.app/$hypedrum',
    className: 'bg-[#00d54b] text-black hover:bg-[#00bf43]',
  },
] as const;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0"
      aria-label={`Copy ${label} handle`}
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked — the link and QR still work.
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function DonateSection() {
  return (
    <div className="space-y-3">
      <Separator />

      <div className="space-y-2 text-center">
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Heart className="h-3.5 w-3.5 text-primary" />
          Free, no accounts, no uploads. Tips keep it that way.
        </p>

        <div className="space-y-1.5">
          {METHODS.map((method) => (
            <div key={method.id} className="flex items-center gap-1.5">
              <Button asChild size="sm" className={`h-10 flex-1 gap-2 ${method.className}`}>
                <a href={method.url} target="_blank" rel="noopener noreferrer">
                  {method.label}
                  <span className="text-xs opacity-80">{method.handle}</span>
                </a>
              </Button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={`Show ${method.label} QR code`}
                    title={`${method.label} QR code`}
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="flex w-auto flex-col items-center gap-2 p-4">
                  <p className="text-sm font-medium">{method.label}</p>
                  <div className="rounded-lg bg-white p-3">
                    <QRCode value={method.url} size={150} />
                  </div>
                  <p className="text-xs text-muted-foreground">{method.handle}</p>
                </PopoverContent>
              </Popover>

              <CopyButton value={method.handle} label={method.label} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
