import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@gitinspect/ui/lib/utils";

type IconProps = ComponentPropsWithoutRef<"svg">;

function IconBase({ children, className, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  logo: (props: IconProps) => (
    <IconBase aria-label="Logo" id="search-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="16 17 15 17 15 18 13 18 13 19 7 19 7 18 5 18 5 17 4 17 4 16 3 16 3 15 2 15 2 13 1 13 1 7 2 7 2 5 3 5 3 4 4 4 4 3 5 3 5 2 7 2 7 1 13 1 13 2 15 2 15 3 16 3 16 4 17 4 17 5 18 5 18 7 19 7 19 13 18 13 18 15 17 15 17 16 16 16 16 17" />
      <polygon points="23 20 23 22 22 22 22 23 20 23 20 22 19 22 19 21 18 21 18 20 17 20 17 19 16 19 16 18 17 18 17 17 18 17 18 16 19 16 19 17 20 17 20 18 21 18 21 19 22 19 22 20 23 20" />
    </IconBase>
  ),
  cog: (props: IconProps) => (
    <IconBase aria-label="Settings" id="cog-solid" viewBox="0 0 24 24" {...props}>
      <path d="m21,10v-1h-1v-2h1v-2h-1v-1h-1v-1h-2v1h-2v-1h-1V1h-4v2h-1v1h-2v-1h-2v1h-1v1h-1v2h1v2h-1v1H1v4h2v1h1v2h-1v2h1v1h1v1h2v-1h2v1h1v2h4v-2h1v-1h2v1h2v-1h1v-1h1v-2h-1v-2h1v-1h2v-4h-2Zm-11,0v-1h4v1h1v4h-1v1h-4v-1h-1v-4h1Z" />
    </IconBase>
  ),
  crown: (props: IconProps) => (
    <IconBase aria-label="Get Pro" id="crown-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 7 23 9 22 9 22 10 21 10 21 14 20 14 20 17 19 17 19 19 18 19 18 21 6 21 6 19 5 19 5 17 4 17 4 14 3 14 3 10 2 10 2 9 1 9 1 7 2 7 2 6 4 6 4 7 5 7 5 9 4 9 4 10 5 10 5 11 6 11 6 12 8 12 8 11 9 11 9 9 10 9 10 7 11 7 11 6 10 6 10 4 11 4 11 3 13 3 13 4 14 4 14 6 13 6 13 7 14 7 14 9 15 9 15 11 16 11 16 12 18 12 18 11 19 11 19 10 20 10 20 9 19 9 19 7 20 7 20 6 22 6 22 7 23 7" />
    </IconBase>
  ),
  x: (props: IconProps) => (
    <IconBase id="x" viewBox="0 0 24 24" {...props}>
      <path d="m15.5,10v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h-3v1h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-2h-1v-1h-1v-1H1.5v1h1v1h1v1h1v2h1v1h1v2h1v1h1v2h1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h3v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v1h1v1h1v2h1v1h1v1h7v-1h-1v-1h-1v-1h-1v-2h-1v-1h-1v-2h-1v-1h-1v-2h-1v-1h1Zm0,4v1h1v2h1v1h1v2h-3v-2h-1v-1h-1v-1h-1v-2h-1v-1h-1v-1h-1v-2h-1v-1h-1v-2h-1v-1h-1v-2h3v1h1v2h1v1h1v2h1v1h1v1h1v2h1Z" />
    </IconBase>
  ),
  gitHub: (props: IconProps) => (
    <IconBase aria-label="GitHub" id="github" viewBox="0 0 24 24" {...props}>
      <polygon points="23 9 23 15 22 15 22 17 21 17 21 19 20 19 20 20 19 20 19 21 18 21 18 22 16 22 16 23 15 23 15 18 14 18 14 17 15 17 15 16 17 16 17 15 18 15 18 14 19 14 19 9 18 9 18 6 16 6 16 7 15 7 15 8 14 8 14 7 10 7 10 8 9 8 9 7 8 7 8 6 6 6 6 9 5 9 5 14 6 14 6 15 7 15 7 16 9 16 9 18 7 18 7 17 6 17 6 16 4 16 4 17 5 17 5 19 6 19 6 20 9 20 9 23 8 23 8 22 6 22 6 21 5 21 5 20 4 20 4 19 3 19 3 17 2 17 2 15 1 15 1 9 2 9 2 7 3 7 3 5 4 5 4 4 5 4 5 3 7 3 7 2 9 2 9 1 15 1 15 2 17 2 17 3 19 3 19 4 20 4 20 5 21 5 21 7 22 7 22 9 23 9" />
    </IconBase>
  ),
  close: (props: IconProps) => (
    <IconBase aria-label="Close" id="times" viewBox="0 0 24 24" {...props}>
      <rect fill="none" height="24" width="24" />
      <path d="m18.3 5.7-12.6 12.6c-.2.2-.2.5 0 .7.2.2.5.2.7 0l12.6-12.6c.2-.2.2-.5 0-.7-.2-.2-.5-.2-.7 0Z" />
      <path d="m5.7 5.7 12.6 12.6c.2.2.5.2.7 0 .2-.2.2-.5 0-.7L6.4 5c-.2-.2-.5-.2-.7 0-.2.2-.2.5 0 .7Z" />
    </IconBase>
  ),
  sun: (props: IconProps) => (
    <IconBase aria-label="Sun" id="brightness-high" viewBox="0 0 24 24" {...props}>
      <polygon points="4 5 3 5 3 4 4 4 4 3 5 3 5 4 6 4 6 5 7 5 7 6 8 6 8 7 7 7 7 8 6 8 6 7 5 7 5 6 4 6 4 5" />
      <rect height="2" width="5" x="1" y="11" />
      <polygon points="7 17 8 17 8 18 7 18 7 19 6 19 6 20 5 20 5 21 4 21 4 20 3 20 3 19 4 19 4 18 5 18 5 17 6 17 6 16 7 16 7 17" />
      <rect height="5" width="2" x="11" y="18" />
      <rect height="5" width="2" x="11" y="1" />
      <rect height="2" width="5" x="18" y="11" />
      <polygon points="17 7 16 7 16 6 17 6 17 5 18 5 18 4 19 4 19 3 20 3 20 4 21 4 21 5 20 5 20 6 19 6 19 7 18 7 18 8 17 8 17 7" />
      <polygon points="21 19 21 20 20 20 20 21 19 21 19 20 18 20 18 19 17 19 17 18 16 18 16 17 17 17 17 16 18 16 18 17 19 17 19 18 20 18 20 19 21 19" />
      <path d="m16,14h1v-4h-1v-2h-2v-1h-4v1h-2v2h-1v4h1v2h2v1h4v-1h2v-2Zm-1,0h-1v1h-4v-1h-1v-4h1v-1h4v1h1v4Z" />
    </IconBase>
  ),
  bank: (props: IconProps) => (
    <IconBase aria-label="Data" id="bank-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 20 23 22 22 22 22 23 2 23 2 22 1 22 1 20 3 20 3 19 4 19 4 10 6 10 6 19 8 19 8 10 10 10 10 19 14 19 14 10 16 10 16 19 18 19 18 10 20 10 20 19 21 19 21 20 23 20" />
      <path d="m20,5v-1h-2v-1h-2v-1h-2v-1h-4v1h-2v1h-2v1h-2v1H1v2h1v1h1v1h18v-1h1v-1h1v-2h-3Zm-9,2v-1h-1v-2h1v-1h2v1h1v2h-1v1h-2Z" />
    </IconBase>
  ),
  cost: (props: IconProps) => (
    <IconBase aria-label="Costs" id="box-usd-solid" viewBox="0 0 24 24" {...props}>
      <path d="m1,9v13h1v1h20v-1h1v-13H1Zm12,11v2h-2v-2h-2v-2h4v-1h-3v-1h-1v-4h2v-2h2v2h2v2h-4v1h3v1h1v4h-2Z" />
      <polygon points="11 1 11 7 1 7 1 6 2 6 2 4 3 4 3 3 4 3 4 2 5 2 5 1 11 1" />
      <polygon points="23 6 23 7 13 7 13 1 19 1 19 2 20 2 20 3 21 3 21 4 22 4 22 6 23 6" />
    </IconBase>
  ),
  globe: (props: IconProps) => (
    <IconBase aria-label="Proxy" id="globe-solid" viewBox="0 0 24 24" {...props}>
      <rect height="1" width="1" x="9" y="1" />
      <polygon points="9 2 9 3 8 3 8 5 7 5 7 8 2 8 2 7 3 7 3 5 4 5 4 4 5 4 5 3 7 3 7 2 9 2" />
      <polygon points="13 2 14 2 14 4 15 4 15 6 16 6 16 8 8 8 8 6 9 6 9 4 10 4 10 2 11 2 11 1 13 1 13 2" />
      <rect height="1" width="1" x="14" y="1" />
      <polygon points="22 7 22 8 17 8 17 5 16 5 16 3 15 3 15 2 17 2 17 3 19 3 19 4 20 4 20 5 21 5 21 7 22 7" />
      <polygon points="17 10 17 14 16 14 16 15 8 15 8 14 7 14 7 10 8 10 8 9 16 9 16 10 17 10" />
      <polygon points="1 9 7 9 7 10 6 10 6 14 7 14 7 15 1 15 1 9" />
      <polygon points="23 9 23 15 17 15 17 14 18 14 18 10 17 10 17 9 23 9" />
      <polygon points="22 16 22 17 21 17 21 19 20 19 20 20 19 20 19 21 17 21 17 22 15 22 15 21 16 21 16 19 17 19 17 16 22 16" />
      <rect height="1" width="1" x="9" y="22" />
      <polygon points="9 21 9 22 7 22 7 21 5 21 5 20 4 20 4 19 3 19 3 17 2 17 2 16 7 16 7 19 8 19 8 21 9 21" />
      <rect height="1" width="1" x="14" y="22" />
      <polygon points="14 22 13 22 13 23 11 23 11 22 10 22 10 20 9 20 9 18 8 18 8 16 16 16 16 18 15 18 15 20 14 20 14 22" />
    </IconBase>
  ),
  badgeCheck: (props: IconProps) => (
    <IconBase aria-label="Providers" id="badge-check-solid" viewBox="0 0 24 24" {...props}>
      <path d="m22,10v-1h-1v-4h-1v-1h-1v-1h-4v-1h-1v-1h-4v1h-1v1h-4v1h-1v1h-1v4h-1v1h-1v4h1v1h1v4h1v1h1v1h4v1h1v1h4v-1h1v-1h4v-1h1v-1h1v-4h1v-1h1v-4h-1Zm-15,1h1v-1h1v1h1v1h2v-1h1v-1h1v-1h1v-1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-2Z" />
    </IconBase>
  ),
  faceThinking: (props: IconProps) => (
    <IconBase aria-label="Thinking" id="face-thinking-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="11 20 10 20 10 22 9 22 9 23 5 23 5 22 4 22 4 16 5 16 5 15 6 15 6 18 8 18 8 17 10 17 10 16 12 16 12 15 14 15 14 17 13 17 13 18 11 18 11 20" />
      <path d="m22,9v-2h-1v-2h-1v-1h-1v-1h-2v-1h-2v-1h-6v1h-2v1h-2v1h-1v1h-1v2h-1v2h-1v6h1v1h1v-1h1v-1h3v2h2v-1h2v-1h-1v-1h-2v-1h3v1h2v1h2v4h-1v1h-2v2h-1v2h4v-1h2v-1h2v-1h1v-1h1v-2h1v-2h1v-6h-1Zm-7-2h3v1h1v2h-1v-1h-1v-1h-2v-1Zm-1,2h2v2h-2v-2Zm-4,1h-2v-2h2v2Zm1-2v-1h-1v-1h-2v1h-2v-1h1v-1h4v1h1v1h1v1h-2Z" />
    </IconBase>
  ),
  moon: (props: IconProps) => (
    <IconBase aria-label="Moon" id="moon-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="22 17 22 19 21 19 21 20 20 20 20 21 18 21 18 22 16 22 16 23 10 23 10 22 8 22 8 21 6 21 6 20 5 20 5 19 4 19 4 17 3 17 3 15 2 15 2 9 3 9 3 7 4 7 4 5 5 5 5 4 6 4 6 3 8 3 8 2 10 2 10 1 15 1 15 2 13 2 13 3 11 3 11 4 10 4 10 6 9 6 9 8 8 8 8 12 9 12 9 14 10 14 10 16 11 16 11 17 13 17 13 18 15 18 15 19 19 19 19 18 21 18 21 17 22 17" />
    </IconBase>
  ),
  home: (props: IconProps) => (
    <IconBase aria-label="Home" id="home-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 11 23 12 20 12 20 22 19 22 19 23 15 23 15 16 9 16 9 23 5 23 5 22 4 22 4 12 1 12 1 11 2 11 2 10 3 10 3 9 4 9 4 8 5 8 5 7 6 7 6 6 7 6 7 5 8 5 8 4 9 4 9 3 10 3 10 2 11 2 11 1 13 1 13 2 14 2 14 3 15 3 15 4 16 4 16 5 17 5 17 6 18 6 18 7 19 7 19 8 20 8 20 9 21 9 21 10 22 10 22 11 23 11" />
    </IconBase>
  ),
  indent: (props: IconProps) => (
    <IconBase aria-label="Sidebar" id="bars-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="22 11 23 11 23 13 22 13 22 14 2 14 2 13 1 13 1 11 2 11 2 10 22 10 22 11" />
      <polygon points="22 19 23 19 23 21 22 21 22 22 2 22 2 21 1 21 1 19 2 19 2 18 22 18 22 19" />
      <polygon points="23 3 23 5 22 5 22 6 2 6 2 5 1 5 1 3 2 3 2 2 22 2 22 3 23 3" />
    </IconBase>
  ),
  trending: (props: IconProps) => (
    <IconBase aria-label="Trending" id="trending-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 5 23 15 22 15 22 14 21 14 21 13 20 13 20 12 18 12 18 13 17 13 17 14 16 14 16 15 15 15 15 16 14 16 14 17 13 17 13 18 12 18 12 19 10 19 10 18 9 18 9 17 8 17 8 16 7 16 7 15 5 15 5 16 4 16 4 17 1 17 1 14 2 14 2 13 3 13 3 12 4 12 4 11 5 11 5 10 7 10 7 11 8 11 8 12 9 12 9 13 10 13 10 14 12 14 12 13 13 13 13 12 14 12 14 11 15 11 15 10 16 10 16 8 15 8 15 7 14 7 14 6 13 6 13 5 23 5" />
    </IconBase>
  ),
  clock: (props: IconProps) => (
    <IconBase aria-label="Clock" id="clock-solid" viewBox="0 0 24 24" {...props}>
      <path d="m22,9v-2h-1v-2h-1v-1h-1v-1h-2v-1h-2v-1h-6v1h-2v1h-2v1h-1v1h-1v2h-1v2h-1v6h1v2h1v2h1v1h1v1h2v1h2v1h6v-1h2v-1h2v-1h1v-1h1v-2h1v-2h1v-6h-1Zm-9,7v-1h-1v-1h-1V5h2v8h1v1h1v1h1v1h-1v1h-1v-1h-1Z" />
    </IconBase>
  ),
  sparkles: (props: IconProps) => (
    <IconBase aria-label="Sparkles" id="sparkles-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 18 23 20 21 20 21 21 20 21 20 23 18 23 18 21 17 21 17 20 15 20 15 18 17 18 17 17 18 17 18 15 20 15 20 17 21 17 21 18 23 18" />
      <polygon points="23 4 23 6 21 6 21 7 20 7 20 9 18 9 18 7 17 7 17 6 15 6 15 4 17 4 17 3 18 3 18 1 20 1 20 3 21 3 21 4 23 4" />
      <polygon points="17 11 17 13 15 13 15 14 13 14 13 15 12 15 12 16 11 16 11 18 10 18 10 20 8 20 8 18 7 18 7 16 6 16 6 15 5 15 5 14 3 14 3 13 1 13 1 11 3 11 3 10 5 10 5 9 6 9 6 8 7 8 7 6 8 6 8 4 10 4 10 6 11 6 11 8 12 8 12 9 13 9 13 10 15 10 15 11 17 11" />
    </IconBase>
  ),
  copy: (props: IconProps) => (
    <IconBase aria-label="Copy" id="copy" viewBox="0 0 24 24" {...props}>
      <polygon points="16 20 16 22 15 22 15 23 3 23 3 22 2 22 2 6 3 6 3 5 6 5 6 20 16 20" />
      <path d="m16,7V1h-8v1h-1v16h1v1h13v-1h1V7h-6Zm4,10h-11V3h5v6h6v8Z" />
      <polygon points="22 5 22 6 17 6 17 1 18 1 18 2 19 2 19 3 20 3 20 4 21 4 21 5 22 5" />
    </IconBase>
  ),
  comment: (props: IconProps) => (
    <IconBase aria-label="Comment" id="comment-dots-solid" viewBox="0 0 24 24" {...props}>
      <path d="m22,8v-2h-1v-1h-1v-1h-2v-1h-3v-1h-6v1h-3v1h-2v1h-1v1h-1v2h-1v6h1v2h1v2h-1v1h-1v2h5v-1h1v-1h2v1h6v-1h3v-1h2v-1h1v-1h1v-2h1v-6h-1Zm-6,5v-1h-1v-2h1v-1h2v1h1v2h-1v1h-2Zm-6-1v-2h1v-1h2v1h1v2h-1v1h-2v-1h-1Zm-2-3v1h1v2h-1v1h-2v-1h-1v-2h1v-1h2Z" />
    </IconBase>
  ),
  thumbsDown: (props: IconProps) => (
    <IconBase aria-label="Thumbs down" id="thumbsdown-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="6 2 6 15 2 15 2 14 1 14 1 3 2 3 2 2 6 2" />
      <polygon points="23 12 23 14 22 14 22 15 15 15 15 17 16 17 16 21 15 21 15 22 13 22 13 21 12 21 12 18 11 18 11 16 10 16 10 15 9 15 9 14 8 14 8 5 9 5 9 4 10 4 10 3 12 3 12 2 19 2 19 3 20 3 20 6 21 6 21 9 22 9 22 12 23 12" />
    </IconBase>
  ),
  thumbsUp: (props: IconProps) => (
    <IconBase aria-label="Thumbs up" id="thumbsup-solid" viewBox="0 0 24 24" {...props}>
      <polygon points="23 10 23 12 22 12 22 15 21 15 21 18 20 18 20 21 19 21 19 22 12 22 12 21 10 21 10 20 9 20 9 19 8 19 8 10 9 10 9 9 10 9 10 8 11 8 11 6 12 6 12 3 13 3 13 2 15 2 15 3 16 3 16 7 15 7 15 9 22 9 22 10 23 10" />
      <polygon points="6 9 6 22 2 22 2 21 1 21 1 10 2 10 2 9 6 9" />
    </IconBase>
  ),
  writing: (props: IconProps) => (
    <IconBase aria-label="Writing" id="writing" viewBox="0 0 24 24" {...props}>
      <path d="M23.5049 7.5012V9.50166H22.5047V10.5019H21.5045V9.50166H20.5043V8.50143H19.504V7.5012H20.5043V6.50098H22.5047V7.5012H23.5049Z" />
      <path d="M21.5046 10.5019V11.5021H20.5044V12.5024H19.5041V13.5026H18.5039V14.5028H17.5037V15.5031H16.5035V16.5033H15.5032V17.5035H14.503V18.5037H11.5023V15.5031H12.5025V14.5028H13.5028V13.5026H14.503V12.5024H15.5032V11.5021H16.5035V10.5019H17.5037V9.50169H18.5039V8.50146H19.5041V9.50169H20.5044V10.5019H21.5046Z" />
      <path d="M17.5036 2.50023V1.5H2.50023V2.50023H1.5V22.5048H2.50023V23.505H17.5036V22.5048H18.5039V16.5034H17.5036V17.5036H16.5034V18.5039H15.5032V19.5041H10.502V14.503H11.5023V13.5027H12.5025V12.5025H13.5027V11.5023H14.503V10.502H15.5032V9.50182H16.5034V8.50159H17.5036V7.50136H18.5039V2.50023H17.5036ZM16.5034 5.50091H3.50045V4.50068H16.5034V5.50091ZM14.503 8.50159H3.50045V7.50136H14.503V8.50159ZM8.50159 17.5036H3.50045V16.5034H8.50159V17.5036ZM3.50045 14.503V13.5027H9.50182V14.503H3.50045ZM3.50045 11.5023V10.502H12.5025V11.5023H3.50045Z" />
    </IconBase>
  ),
};
