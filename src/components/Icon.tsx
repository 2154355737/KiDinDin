const paths: Record<string, string> = {
  chevron: "m9 18 6-6 6-6",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13.5v3m0 14v3m10-10h-3M5 12H2m17.07-7.07-2.12 2.12M7.05 16.95l-2.12 2.12m14.14 0-2.12-2.12M7.05 7.05 4.93 4.93",
  clock: "M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  plus: "M12 5v14M5 12h14",
  play: "m8 5 11 7-11 7Z",
  pause: "M8 5h3v14H8zm5 0h3v14h-3z",
  check: "m5 12 4 4L19 6",
  close: "M6 6l12 12M18 6 6 18",
  logout: "M10 17l5-5-5-5m5 5H3m10-8V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1",
  home: "M3 10.8 12 3l9 7.8V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  send: "m21 3-8.6 18-2.4-8.2L3 9.7Z M10 13l5-5",
  search: "m21 21-4.6-4.6M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  filter: "M4 6h16M7 12h10m-7 6h4",
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.check} /></svg>;
}
