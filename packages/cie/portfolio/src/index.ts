export {
  PORTFOLIO_MODEL_VERSION,
  type PortfolioContent,
  type PortfolioFact,
  type PortfolioGraphEvidence,
  type PortfolioInput,
  type PortfolioItem,
  type PortfolioProject,
  type PortfolioSkillItem,
  type PortfolioVerification,
  type PortfolioViolation,
} from './model.js';
export { generatePortfolio, verifyPortfolio } from './generator.js';
export {
  PortfolioIntegrityError,
  PortfolioService,
  type PortfolioEvidencePort,
  type PortfolioGraphPort,
  type PortfolioProfilePort,
  type PortfolioProjectPort,
  type PortfolioServiceDeps,
} from './service.js';