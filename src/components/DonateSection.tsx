import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

function QRPopover({ url, label, children }: { url: string; label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-4 flex flex-col items-center gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <div className="rounded-lg bg-white p-3">
          <QRCode value={url} size={160} />
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          or open link
        </a>
      </PopoverContent>
    </Popover>
  );
}

export function DonateSection() {
  return (
    <div className="space-y-3">
      <Separator />
      <div className="text-center space-y-3">
        <p className="text-xs text-muted-foreground">
          If you like this app, feel free to support it
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <QRPopover url="https://paypal.me/losfiesta" label="Donate via PayPal">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
              </svg>
              PayPal
            </Button>
          </QRPopover>

          <QRPopover url="https://cash.app/$hypedrum" label="Donate via Cash App">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M23.59 3.474A11.997 11.997 0 0 0 20.526.41C19.162-.085 17.48 0 14.114 0H9.886C6.52 0 4.838-.085 3.474.41A11.997 11.997 0 0 0 .41 3.474C-.085 4.838 0 6.52 0 9.886v4.228c0 3.366-.085 5.048.41 6.412A11.997 11.997 0 0 0 3.474 23.59C4.838 24.085 6.52 24 9.886 24h4.228c3.366 0 5.048.085 6.412-.41A11.997 11.997 0 0 0 23.59 20.526C24.085 19.162 24 17.48 24 14.114V9.886c0-3.366.085-5.048-.41-6.412zM13.2 17.9l-.243 1.722a.5.5 0 0 1-.496.428h-1.002a.5.5 0 0 1-.496-.578l.243-1.716a5.485 5.485 0 0 1-2.866-1.075.5.5 0 0 1-.056-.724l.903-1.012a.5.5 0 0 1 .69-.054c.609.498 1.37.766 2.154.76 1.003 0 1.61-.468 1.61-1.17 0-.617-.404-1.003-1.61-1.343-1.87-.514-3.12-1.343-3.12-3.064 0-1.567 1.087-2.734 2.868-3.12l.243-1.721a.5.5 0 0 1 .496-.428h1.003a.5.5 0 0 1 .496.578l-.237 1.686c.813.13 1.578.46 2.226.959a.5.5 0 0 1 .072.716l-.89 1.021a.5.5 0 0 1-.69.064 3.015 3.015 0 0 0-1.855-.627c-.976 0-1.49.441-1.49 1.063 0 .576.45.948 1.747 1.322 1.87.514 2.983 1.39 2.983 3.106C15.882 16.27 14.84 17.498 13.2 17.9z" />
              </svg>
              Cash App
            </Button>
          </QRPopover>
        </div>
      </div>
    </div>
  );
}
