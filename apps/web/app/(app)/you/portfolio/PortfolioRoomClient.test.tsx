import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { portfolioPublishTokenResponseSchema, publicPortfolioResponseSchema } from '@careeros/contracts';
import { ApiError } from '@/api';
import { PortfolioRoomClient, type PortfolioRoomDependencies } from './PortfolioRoomClient';
import {
  GROUNDED_PORTFOLIO,
  INSUFFICIENT_PORTFOLIO,
  PORTFOLIO_SLUG,
  PUBLIC_PORTFOLIO,
  PUBLISH_GRANT,
  PUBLISHED_PORTFOLIO,
  UPDATED_PORTFOLIO,
} from './portfolio-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<PortfolioRoomDependencies> = {}): PortfolioRoomDependencies {
  return {
    getOwner: () => Promise.resolve(GROUNDED_PORTFOLIO),
    generate: () => Promise.resolve(UPDATED_PORTFOLIO),
    mintPublishToken: () => Promise.resolve(PUBLISH_GRANT),
    publish: () => Promise.resolve(PUBLISHED_PORTFOLIO),
    getPublic: () => Promise.resolve(PUBLIC_PORTFOLIO),
    ...overrides,
  };
}

describe('FM6.6 Portfolio room', () => {
  it('renders grounded headline, summary, projects, skills, and every factRef without AiSurface or confidence', async () => {
    render(<PortfolioRoomClient dependencies={dependencies()} />);

    const draft = await screen.findByRole('article', { name: 'Portfolio draft' });
    expect(draft).toHaveTextContent('Senior platform engineer');
    expect(draft).toHaveTextContent('Builds reliable developer platforms.');
    expect(draft).toHaveTextContent('Deployment Safety Platform');
    expect(draft).toHaveTextContent('TypeScript');
    expect(draft).toHaveTextContent('Kubernetes');
    for (const factRef of ['experience:acme', 'project:deploy-safety', 'skill:typescript', 'graph:kubernetes']) {
      expect(draft).toHaveTextContent(factRef);
    }
    expect(draft).toHaveTextContent('Generation provenance: post-guardrail model portfolio@fake-grounded');
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confidence-chip')).not.toBeInTheDocument();
  });

  it('recovers from an owner 404 by generating the first private draft through POST /v1/portfolio', async () => {
    const generate = vi.fn(() => Promise.resolve(GROUNDED_PORTFOLIO));
    const user = userEvent.setup();
    render(<PortfolioRoomClient dependencies={dependencies({
      getOwner: () => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'No portfolio generated yet.' })),
      generate,
    })} />);

    expect(await screen.findByRole('heading', { name: 'No portfolio draft yet' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Generate portfolio' }));
    expect(generate).toHaveBeenCalledOnce();
    expect(await screen.findByRole('article', { name: 'Portfolio draft' })).toHaveTextContent('Senior platform engineer');
    expect(screen.getByText('private')).toBeVisible();
  });

  it('renders InsufficientData with the backend reason and cannot mint or publish', async () => {
    const mintPublishToken = vi.fn(() => Promise.reject(new Error('must not mint')));
    const publish = vi.fn(() => Promise.reject(new Error('must not publish')));
    render(<PortfolioRoomClient dependencies={dependencies({
      getOwner: () => Promise.resolve(INSUFFICIENT_PORTFOLIO),
      mintPublishToken,
      publish,
    })} />);

    const insufficient = await screen.findByTestId('insufficient-data');
    expect(insufficient).toHaveTextContent('No grounded portfolio claims are available yet.');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText('Insufficient-data drafts cannot be published.')).toBeVisible();
    expect(mintPublishToken).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
  });

  it('mints, shows the exact public preview, and publishes only after explicit confirmation', async () => {
    let resolvePublish: ((value: typeof PUBLISHED_PORTFOLIO) => void) | undefined;
    const mintPublishToken = vi.fn(() => Promise.resolve(PUBLISH_GRANT));
    const publish = vi.fn(() => new Promise<typeof PUBLISHED_PORTFOLIO>((resolve) => { resolvePublish = resolve; }));
    const user = userEvent.setup();
    render(<PortfolioRoomClient dependencies={dependencies({ mintPublishToken, publish })} />);

    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    expect(publish).not.toHaveBeenCalled();
    await user.click(publishButton);

    const dialog = await screen.findByRole('dialog', { name: "Here's exactly what will become public" });
    expect(mintPublishToken).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent(PUBLISH_GRANT.content.headline.text);
    expect(dialog).toHaveTextContent('project:deploy-safety');
    expect(dialog).toHaveTextContent(PUBLISH_GRANT.payloadHash);

    await user.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(PUBLISH_GRANT.token);
    expect(screen.queryByTestId('portfolio-publish-preview')).not.toBeInTheDocument();
    expect(screen.getByText('Publishing the confirmed snapshot…')).toBeVisible();

    resolvePublish?.(PUBLISHED_PORTFOLIO);
    expect(await screen.findByText('Published only after your explicit confirmation.')).toBeVisible();
    expect(screen.getByText('published')).toBeVisible();
  });

  it('closing the exact preview keeps the portfolio private and never publishes', async () => {
    const publish = vi.fn(() => Promise.resolve(PUBLISHED_PORTFOLIO));
    const user = userEvent.setup();
    render(<PortfolioRoomClient dependencies={dependencies({ publish })} />);
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog', { name: "Here's exactly what will become public" });
    await user.click(within(dialog).getByRole('button', { name: 'Keep private' }));
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('private')).toBeVisible();
  });

  it('approval mismatch discards the stale token and forces a fresh mint, preview, and confirmation', async () => {
    const mismatch = new ApiError({
      code: 'capability_denied',
      status: 403,
      message: "Action 'portfolio.publish' requires approval (approval_payload_mismatch).",
      details: { action: 'portfolio.publish', reason: 'approval_payload_mismatch' },
    });
    const freshGrant = portfolioPublishTokenResponseSchema.parse({
      ...PUBLISH_GRANT,
      token: 'fresh-single-use-token',
      content: UPDATED_PORTFOLIO.content.status === 'ready' ? UPDATED_PORTFOLIO.content : PUBLISH_GRANT.content,
      payloadHash: 'b'.repeat(64),
    });
    const getOwner = vi.fn()
      .mockResolvedValueOnce(GROUNDED_PORTFOLIO)
      .mockResolvedValue(UPDATED_PORTFOLIO);
    const mintPublishToken = vi.fn()
      .mockResolvedValueOnce(PUBLISH_GRANT)
      .mockResolvedValueOnce(freshGrant);
    const publish = vi.fn()
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValueOnce({ ...PUBLISHED_PORTFOLIO, content: freshGrant.content });
    const user = userEvent.setup();
    render(<PortfolioRoomClient dependencies={dependencies({ getOwner, mintPublishToken, publish })} />);

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm publish' }));

    const recovery = await screen.findByTestId('portfolio-mismatch-recovery');
    expect(recovery).toHaveTextContent('Nothing was published. The stale token was discarded.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(PUBLISH_GRANT.token);
    expect(await screen.findByText('Updated platform engineer')).toBeVisible();

    await user.click(within(recovery).getByRole('button', { name: 'Request a fresh public preview' }));
    const freshDialog = await screen.findByRole('dialog');
    expect(mintPublishToken).toHaveBeenCalledTimes(2);
    expect(freshDialog).toHaveTextContent('Updated platform engineer');
    await user.click(within(freshDialog).getByRole('button', { name: 'Confirm publish' }));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(freshGrant.token);
  });

  it('public 404 is honest and a published public view renders only public-endpoint content', async () => {
    const publishedOnly = publicPortfolioResponseSchema.parse({
      ...PUBLIC_PORTFOLIO,
      content: {
        ...PUBLIC_PORTFOLIO.content,
        headline: { text: 'Frozen public headline', factRefs: ['public:headline'] },
        projects: [{
          title: 'Frozen public project',
          description: 'Only the published snapshot.',
          skills: [],
          factRefs: ['public:project'],
        }],
      },
    });
    const getPublic = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'not_found', status: 404, message: 'Portfolio not found.' }))
      .mockResolvedValueOnce(publishedOnly);
    const user = userEvent.setup();
    render(<PortfolioRoomClient dependencies={dependencies({ getPublic })} />);

    await user.click(await screen.findByRole('button', { name: 'Check public view' }));
    const notPublished = await screen.findByTestId('public-not-published');
    expect(notPublished).toHaveTextContent('No owner draft or private profile data is shown here.');
    expect(notPublished).not.toHaveTextContent('Senior platform engineer');

    await user.click(screen.getByRole('button', { name: 'Check public view' }));
    const publicView = await screen.findByTestId('public-portfolio');
    expect(publicView).toHaveTextContent('Frozen public headline');
    expect(publicView).toHaveTextContent('Frozen public project');
    expect(publicView).toHaveTextContent('public:headline');
    expect(publicView).not.toHaveTextContent('Deployment Safety Platform');
    expect(getPublic).toHaveBeenNthCalledWith(1, PORTFOLIO_SLUG);
    expect(getPublic).toHaveBeenNthCalledWith(2, PORTFOLIO_SLUG);
  });

  it('owner shape drift fails typed instead of rendering private or unparsed data', async () => {
    const drifted = { ...GROUNDED_PORTFOLIO, privateProfile: 'must not render' } as typeof GROUNDED_PORTFOLIO;
    render(<PortfolioRoomClient dependencies={dependencies({ getOwner: () => Promise.resolve(drifted) })} />);
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', 'internal');
    expect(screen.queryByText('must not render')).not.toBeInTheDocument();
  });

  it('generate, mint, publish, and public errors each expose an endpoint-specific typed retry', async () => {
    const user = userEvent.setup();
    const generate = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'internal', message: 'Generate failed.' }))
      .mockResolvedValue(UPDATED_PORTFOLIO);
    const mintPublishToken = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'rate_limited', status: 429, message: 'Mint rate limited.', details: { retryAfterSeconds: 1 } }))
      .mockResolvedValue(PUBLISH_GRANT);
    const publish = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'capability_denied', status: 403, message: 'A fresh approval is required.', details: { action: 'portfolio.publish', reason: 'approval_expired' } }))
      .mockResolvedValue(PUBLISHED_PORTFOLIO);
    const getPublic = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 'internal', message: 'Public read failed.' }))
      .mockResolvedValue(PUBLIC_PORTFOLIO);
    render(<PortfolioRoomClient dependencies={dependencies({ generate, mintPublishToken, publish, getPublic })} />);
    await screen.findByRole('article', { name: 'Portfolio draft' });

    await user.click(screen.getByRole('button', { name: 'Update draft from profile' }));
    let recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    await user.click(within(recovery).getByTestId('error-recovery-action'));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Updated platform engineer')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'rate_limited');
    await user.click(within(recovery).getByTestId('error-recovery-action'));
    expect(mintPublishToken).toHaveBeenCalledTimes(2);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'capability_denied');
    await user.click(within(recovery).getByTestId('error-recovery-action'));
    expect(mintPublishToken).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledTimes(1);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep private' }));

    await user.click(screen.getByRole('button', { name: 'Check public view' }));
    recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    await user.click(within(recovery).getByTestId('error-recovery-action'));
    expect(getPublic).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId('public-portfolio')).toBeVisible();
  });
});