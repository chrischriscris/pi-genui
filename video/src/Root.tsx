import { Composition } from "remotion";
import { Launch, type LaunchProps } from "./Launch.tsx";
import { loadTimeline } from "./timeline.ts";

export function Root() {
	return (
		<Composition
			id="Launch"
			component={Launch}
			fps={30}
			width={1920}
			height={1080}
			durationInFrames={300}
			defaultProps={{ cta: "" } satisfies LaunchProps}
			calculateMetadata={async () => {
				const timeline = await loadTimeline();
				return { durationInFrames: timeline.intro + timeline.durationInFrames + timeline.outro, fps: timeline.fps };
			}}
		/>
	);
}
