import type { Request, Response } from 'express';

let cachedApp: any = null;

export default async function handler(req: Request, res: Response) {
    try {
        if (!cachedApp) {
            // Dynamically import the app to catch any top-level initialization errors
            const appModule = await import('../src/index');
            cachedApp = appModule.default;
        }
        return cachedApp(req, res);
    } catch (error: any) {
        console.error("Initialization Error:", error);
        // Expose the error directly to the browser
        return res.status(500).json({
            error: "Server Initialization Failed",
            message: String(error?.message || error),
            stack: String(error?.stack || ""),
        });
    }
}
