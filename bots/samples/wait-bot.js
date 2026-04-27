// wait-bot — does nothing. Useful as a sparring partner / training baseline.
// Should be the easiest bot to beat: any bot that can find it and hit it wins.
export default function decide() {
  return { type: "WAIT" };
}
