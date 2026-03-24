import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

type IconProps = ComponentPropsWithoutRef<"svg">

function IconBase({
  children,
  className,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  )
}

export const Icons = {
  logo: (props: IconProps) => (
    <IconBase
      aria-label="Logo"
      id="search-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="16 17 15 17 15 18 13 18 13 19 7 19 7 18 5 18 5 17 4 17 4 16 3 16 3 15 2 15 2 13 1 13 1 7 2 7 2 5 3 5 3 4 4 4 4 3 5 3 5 2 7 2 7 1 13 1 13 2 15 2 15 3 16 3 16 4 17 4 17 5 18 5 18 7 19 7 19 13 18 13 18 15 17 15 17 16 16 16 16 17" />
      <polygon points="23 20 23 22 22 22 22 23 20 23 20 22 19 22 19 21 18 21 18 20 17 20 17 19 16 19 16 18 17 18 17 17 18 17 18 16 19 16 19 17 20 17 20 18 21 18 21 19 22 19 22 20 23 20" />
    </IconBase>
  ),
  cog: (props: IconProps) => (
    <IconBase
      aria-label="Settings"
      id="cog-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="m21,10v-1h-1v-2h1v-2h-1v-1h-1v-1h-2v1h-2v-1h-1V1h-4v2h-1v1h-2v-1h-2v1h-1v1h-1v2h1v2h-1v1H1v4h2v1h1v2h-1v2h1v1h1v1h2v-1h2v1h1v2h4v-2h1v-1h2v1h2v-1h1v-1h1v-2h-1v-2h1v-1h2v-4h-2Zm-11,0v-1h4v1h1v4h-1v1h-4v-1h-1v-4h1Z" />
    </IconBase>
  ),
  twitter: (props: IconProps) => (
    <IconBase
      aria-label="Twitter"
      id="twitter"
      viewBox="0 0 24 24"
      {...props}
    >
      <rect height={1} width={1} x={22} y={5} />
      <rect height={1} width={1} x={22} y={3} />
      <polygon points="21 5 21 6 22 6 22 7 21 7 21 12 20 12 20 14 19 14 19 16 18 16 18 17 17 17 17 18 16 18 16 19 14 19 14 20 11 20 11 21 4 21 4 20 2 20 2 19 1 19 1 18 3 18 3 19 6 19 6 18 7 18 7 17 5 17 5 16 4 16 4 15 3 15 3 14 5 14 5 13 3 13 3 12 2 12 2 10 4 10 4 9 3 9 3 8 2 8 2 4 3 4 3 5 4 5 4 6 5 6 5 7 7 7 7 8 10 8 10 9 12 9 12 5 13 5 13 4 14 4 14 3 19 3 19 4 22 4 22 5 21 5" />
    </IconBase>
  ),
  gitHub: (props: IconProps) => (
    <IconBase
      aria-label="GitHub"
      id="github"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="23 9 23 15 22 15 22 17 21 17 21 19 20 19 20 20 19 20 19 21 18 21 18 22 16 22 16 23 15 23 15 18 14 18 14 17 15 17 15 16 17 16 17 15 18 15 18 14 19 14 19 9 18 9 18 6 16 6 16 7 15 7 15 8 14 8 14 7 10 7 10 8 9 8 9 7 8 7 8 6 6 6 6 9 5 9 5 14 6 14 6 15 7 15 7 16 9 16 9 18 7 18 7 17 6 17 6 16 4 16 4 17 5 17 5 19 6 19 6 20 9 20 9 23 8 23 8 22 6 22 6 21 5 21 5 20 4 20 4 19 3 19 3 17 2 17 2 15 1 15 1 9 2 9 2 7 3 7 3 5 4 5 4 4 5 4 5 3 7 3 7 2 9 2 9 1 15 1 15 2 17 2 17 3 19 3 19 4 20 4 20 5 21 5 21 7 22 7 22 9 23 9" />
    </IconBase>
  ),
  close: (props: IconProps) => (
    <IconBase
      aria-label="Close"
      id="times"
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="none" height="24" width="24" />
      <path d="m18.3 5.7-12.6 12.6c-.2.2-.2.5 0 .7.2.2.5.2.7 0l12.6-12.6c.2-.2.2-.5 0-.7-.2-.2-.5-.2-.7 0Z" />
      <path d="m5.7 5.7 12.6 12.6c.2.2.5.2.7 0 .2-.2.2-.5 0-.7L6.4 5c-.2-.2-.5-.2-.7 0-.2.2-.2.5 0 .7Z" />
    </IconBase>
  ),
  sun: (props: IconProps) => (
    <IconBase
      aria-label="Sun"
      id="sun-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="17 10 17 14 16 14 16 15 15 15 15 16 14 16 14 17 10 17 10 16 9 16 9 15 8 15 8 14 7 14 7 10 8 10 8 9 9 9 9 8 10 8 10 7 14 7 14 8 15 8 15 9 16 9 16 10 17 10" />
      <path d="m21,11v-1h1v-1h1v-2h-3v-1h-2v-2h-1V1h-2v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-2v3h-1v2h-2v1H1v2h1v1h1v1h1v2h-1v1h-1v1h-1v2h3v1h2v2h1v3h2v-1h1v-1h1v-1h2v1h1v1h1v1h2v-3h1v-2h2v-1h3v-2h-1v-1h-1v-1h-1v-2h1Zm-3,4h-1v1h-1v1h-1v1h-6v-1h-1v-1h-1v-1h-1v-6h1v-1h1v-1h1v-1h6v1h1v1h1v1h1v6Z" />
    </IconBase>
  ),
  moon: (props: IconProps) => (
    <IconBase
      aria-label="Moon"
      id="moon-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="22 17 22 19 21 19 21 20 20 20 20 21 18 21 18 22 16 22 16 23 10 23 10 22 8 22 8 21 6 21 6 20 5 20 5 19 4 19 4 17 3 17 3 15 2 15 2 9 3 9 3 7 4 7 4 5 5 5 5 4 6 4 6 3 8 3 8 2 10 2 10 1 15 1 15 2 13 2 13 3 11 3 11 4 10 4 10 6 9 6 9 8 8 8 8 12 9 12 9 14 10 14 10 16 11 16 11 17 13 17 13 18 15 18 15 19 19 19 19 18 21 18 21 17 22 17" />
    </IconBase>
  ),
  home: (props: IconProps) => (
    <IconBase
      aria-label="Home"
      id="home-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="23 11 23 12 20 12 20 22 19 22 19 23 15 23 15 16 9 16 9 23 5 23 5 22 4 22 4 12 1 12 1 11 2 11 2 10 3 10 3 9 4 9 4 8 5 8 5 7 6 7 6 6 7 6 7 5 8 5 8 4 9 4 9 3 10 3 10 2 11 2 11 1 13 1 13 2 14 2 14 3 15 3 15 4 16 4 16 5 17 5 17 6 18 6 18 7 19 7 19 8 20 8 20 9 21 9 21 10 22 10 22 11 23 11" />
    </IconBase>
  ),
  trending: (props: IconProps) => (
    <IconBase
      aria-label="Trending"
      id="trending-solid"
      viewBox="0 0 24 24"
      {...props}
    >
      <polygon points="23 5 23 15 22 15 22 14 21 14 21 13 20 13 20 12 18 12 18 13 17 13 17 14 16 14 16 15 15 15 15 16 14 16 14 17 13 17 13 18 12 18 12 19 10 19 10 18 9 18 9 17 8 17 8 16 7 16 7 15 5 15 5 16 4 16 4 17 1 17 1 14 2 14 2 13 3 13 3 12 4 12 4 11 5 11 5 10 7 10 7 11 8 11 8 12 9 12 9 13 10 13 10 14 12 14 12 13 13 13 13 12 14 12 14 11 15 11 15 10 16 10 16 8 15 8 15 7 14 7 14 6 13 6 13 5 23 5" />
    </IconBase>
  ),
  writing: (props: IconProps) => (
    <IconBase
      aria-label="Writing"
      id="writing"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M23.5049 7.5012V9.50166H22.5047V10.5019H21.5045V9.50166H20.5043V8.50143H19.504V7.5012H20.5043V6.50098H22.5047V7.5012H23.5049Z" />
      <path d="M21.5046 10.5019V11.5021H20.5044V12.5024H19.5041V13.5026H18.5039V14.5028H17.5037V15.5031H16.5035V16.5033H15.5032V17.5035H14.503V18.5037H11.5023V15.5031H12.5025V14.5028H13.5028V13.5026H14.503V12.5024H15.5032V11.5021H16.5035V10.5019H17.5037V9.50169H18.5039V8.50146H19.5041V9.50169H20.5044V10.5019H21.5046Z" />
      <path d="M17.5036 2.50023V1.5H2.50023V2.50023H1.5V22.5048H2.50023V23.505H17.5036V22.5048H18.5039V16.5034H17.5036V17.5036H16.5034V18.5039H15.5032V19.5041H10.502V14.503H11.5023V13.5027H12.5025V12.5025H13.5027V11.5023H14.503V10.502H15.5032V9.50182H16.5034V8.50159H17.5036V7.50136H18.5039V2.50023H17.5036ZM16.5034 5.50091H3.50045V4.50068H16.5034V5.50091ZM14.503 8.50159H3.50045V7.50136H14.503V8.50159ZM8.50159 17.5036H3.50045V16.5034H8.50159V17.5036ZM3.50045 14.503V13.5027H9.50182V14.503H3.50045ZM3.50045 11.5023V10.502H12.5025V11.5023H3.50045Z" />
    </IconBase>
  ),
}
