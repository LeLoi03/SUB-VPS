// src/container.ts
import 'reflect-metadata'; // Essential for Tsyringe to work with decorators (e.g., @injectable, @singleton)
import { container } from 'tsyringe'; // The main IoC container instance

// --- Core Application Services and Configurations ---
// These services typically form the foundation of the application,
// handling configuration, logging, and common utilities.
import { VpsConfigService } from './config/vpsConfig.service';
import { LoggingService } from './services/logging.service';



/**
 * Configure the Tsyringe IoC container by registering all application services.
 * Services are registered either as singletons (one instance per application lifecycle)
 * or as transient (a new instance each time they are resolved).
 *
 * @remarks
 * Using `registerSingleton` is appropriate for stateless services, shared resources (like config, logger),
 * or services managing application-wide state.
 * Using `register` (transient scope) is suitable for services that need a fresh instance for each request
 * or task, or if they hold mutable state specific to a short-lived operation.
 */

// --- 1. Register Core Application Services ---
// These services are typically stateless or manage global application state,
// making them ideal candidates for singleton registration.

container.registerSingleton(LoggingService);


/**
 * Exports the configured Tsyringe container instance.
 * While direct `container.resolve()` calls can be used, it's often preferred
 * to use `@inject` decorators for constructor injection where possible.
 * This export might be used in `server.ts` or other entry points to resolve
 * the initial set of services (e.g., `ConfigService`, `LoggingService`).
 * @returns {typeof container} The configured Tsyringe container instance.
 */
export default container;