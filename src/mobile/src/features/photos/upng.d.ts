declare module 'upng-js' {
  const UPNG: { decode(data: ArrayBuffer): { width: number; height: number }; toRGBA8(image: { width: number; height: number }): ArrayBuffer[]; encode(images: ArrayBuffer[], width: number, height: number, colors: number): ArrayBuffer };
  export default UPNG;
}
