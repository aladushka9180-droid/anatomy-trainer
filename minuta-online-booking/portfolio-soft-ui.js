(() => {
  'use strict';
  const init = () => {
    const view = document.querySelector('[data-provider-panel="portfolio"]');
    const works = view?.querySelector('#portfolioManageList');
    const reviews = view?.querySelector('#providerReviewsList');
    if (!view || !works || !reviews || view.dataset.portfolioSoftUi) return;
    view.dataset.portfolioSoftUi = 'true';
    const icon = name => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('ui-icon');
      svg.setAttribute('aria-hidden', 'true');
      if (name === 'star') {
        // The shared sprite has fill="none" on its root; keep the same path
        // inline so filled and empty rating stars remain distinguishable.
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.append(path);
        return svg;
      }
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `ui-icons.svg?v=1023#icon-${name}`);
      svg.append(use);
      return svg;
    };
    const reviewPanel = reviews.closest('.provider-reviews-panel');
    const reviewHeading = reviewPanel?.querySelector('.panel-head');
    const reviewTitle = reviewHeading?.querySelector('h3');
    if (reviewTitle) {
      const titleLine = document.createElement('div');
      titleLine.className = 'portfolio-soft-review-title';
      const mark = document.createElement('span');
      mark.className = 'portfolio-soft-review-mark';
      mark.append(icon('star'));
      titleLine.append(mark, reviewTitle);
      const count = reviewHeading.querySelector('#providerReviewsCount');
      if (count) titleLine.append(count);
      const oldTitle = reviewHeading.querySelector('div');
      oldTitle?.replaceWith(titleLine);
      const guide = document.createElement('details');
      guide.className = 'portfolio-soft-review-guide';
      const summary = document.createElement('summary');
      summary.append(icon('info'), document.createTextNode('Как получить отзыв'));
      const help = document.createElement('p');
      help.textContent = 'После завершённого визита клиент может оставить оценку в разделе «Мои записи». Полученный отзыв появится здесь; вы решаете, когда опубликовать его на сайте.';
      guide.append(summary, help);
      reviewHeading.append(guide);
    }
    const reviewDescription = reviewPanel?.querySelector(':scope > p');
    if (reviewDescription) reviewDescription.textContent = 'Отзывы о завершённых визитах. Вы решаете, какие показывать на сайте.';

    let previewTrigger = null;
    const invalidatedCards = new WeakSet();
    const preview = document.createElement('dialog');
    preview.className = 'portfolio-soft-photo-dialog';
    preview.id = 'portfolioPhotoPreviewDialog';
    preview.setAttribute('aria-labelledby', 'portfolioPhotoPreviewTitle');
    const previewHead = document.createElement('div');
    previewHead.className = 'portfolio-soft-photo-head';
    const previewTitle = document.createElement('h3');
    previewTitle.id = 'portfolioPhotoPreviewTitle';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'portfolio-card-menu-trigger';
    close.setAttribute('aria-label', 'Закрыть фотографии');
    close.append(icon('close'));
    previewHead.append(previewTitle, close);
    const previewImages = document.createElement('div');
    previewImages.className = 'portfolio-soft-photo-images';
    preview.append(previewHead, previewImages);
    view.append(preview);
    window.addEventListener('minuta:provider-session-reset', () => {
      for (const card of works.querySelectorAll('.portfolio-card')) {
        invalidatedCards.add(card);
        // Native dialog.close() must not restore focus to the old session.
        card.querySelectorAll('[data-portfolio-photo-preview]').forEach(trigger => { trigger.disabled = true; });
      }
      previewTrigger = null;
      previewImages.replaceChildren();
      previewTitle.textContent = '';
      if (preview.open) preview.close();
    });
    close.addEventListener('click', () => preview.close());
    preview.addEventListener('click', event => { if (event.target === preview) preview.close(); });
    preview.addEventListener('close', () => {
      previewImages.replaceChildren();
      if (previewTrigger?.isConnected && !view.hidden) previewTrigger.focus();
      previewTrigger = null;
    });
    view.addEventListener('click', event => {
      const trigger = event.target.closest('[data-portfolio-photo-preview]');
      if (!trigger || !view.contains(trigger)) return;
      const card = trigger.closest('.portfolio-card');
      if (!card || invalidatedCards.has(card)) return;
      const photos = [...card.querySelectorAll('.portfolio-photo')].filter(photo => photo.querySelector('img'));
      if (!photos.length) return;
      previewTrigger = trigger;
      previewTitle.textContent = card.querySelector('h3')?.textContent || 'Фотографии работы';
      previewImages.replaceChildren();
      previewImages.classList.toggle('is-single', photos.length === 1);
      for (const photo of photos) {
        const original = photo.querySelector('img');
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = original.currentSrc || original.src;
        image.alt = original.alt;
        const caption = document.createElement('figcaption');
        caption.textContent = photo.querySelector(':scope > span')?.textContent || '';
        figure.append(image, caption);
        previewImages.append(figure);
      }
      preview.showModal();
    });

    const enhance = () => {
      if (preview.open && (!previewTrigger?.isConnected || view.hidden)) preview.close();
      const cards = works.querySelectorAll('.portfolio-card');
      view.classList.toggle('portfolio-soft-empty', cards.length === 0);
      for (const empty of works.querySelectorAll('.provider-empty')) empty.classList.add('portfolio-empty-state');
      for (const card of cards) {
        if (card.dataset.portfolioSoftCard) continue;
        card.dataset.portfolioSoftCard = 'true';
        const photos = card.querySelector('.portfolio-card-photos');
        const images = photos?.querySelectorAll('.portfolio-photo img');
        if (images?.length) {
          photos.classList.add(images.length === 1 ? 'is-single' : 'is-pair');
          if (images.length === 1) for (const photo of photos.querySelectorAll('.portfolio-photo')) if (!photo.querySelector('img')) photo.hidden = true;
          const zoom = document.createElement('button');
          zoom.type = 'button';
          zoom.className = 'portfolio-soft-photo-trigger';
          zoom.dataset.portfolioPhotoPreview = 'true';
          zoom.setAttribute('aria-label', `Посмотреть фотографии работы «${card.querySelector('h3')?.textContent || ''}»`);
          zoom.setAttribute('aria-haspopup', 'dialog');
          zoom.setAttribute('aria-controls', preview.id);
          const mark = document.createElement('span');
          mark.append(icon('external'));
          zoom.append(mark);
          photos.append(zoom);
        }
        const status = card.querySelector('.portfolio-card-status');
        if (status) {
          status.prepend(icon(status.classList.contains('published') ? 'check' : 'edit'));
          card.querySelector('.portfolio-card-copy')?.append(status);
        }
      }
      for (const empty of works.querySelectorAll('.portfolio-empty-state .provider-empty-icon use')) empty.setAttribute('href', 'ui-icons.svg?v=1023#icon-image');
      for (const empty of reviews.querySelectorAll('.provider-review-empty-state')) {
        if (empty.dataset.portfolioSoftEmpty) continue;
        empty.dataset.portfolioSoftEmpty = 'true';
        empty.querySelector('.portfolio-empty-actions')?.remove();
        const mark = empty.querySelector('.provider-empty-icon use');
        mark?.setAttribute('href', 'ui-icons.svg?v=1023#icon-star');
        const title = empty.querySelector('strong');
        if (title) title.textContent = 'Пока нет отзывов';
        const help = empty.querySelector('small');
        if (help) help.textContent = 'После завершённого визита клиент сможет оставить оценку.';
      }
      for (const card of reviews.querySelectorAll('.provider-review-card')) {
        if (card.dataset.portfolioSoftReview) continue;
        card.dataset.portfolioSoftReview = 'true';
        const head = card.querySelector('.provider-review-head');
        const name = head?.querySelector('strong');
        const rating = head?.querySelector(':scope > span');
        if (name && rating) {
          const nameLine = document.createElement('div');
          nameLine.className = 'portfolio-soft-review-name';
          const value = Math.max(1, Math.min(5, [...rating.textContent].filter(char => char === '★').length));
          rating.replaceChildren();
          rating.classList.add('portfolio-soft-stars');
          for (let index = 0; index < 5; index++) {
            const star = icon('star');
            if (index < value) star.classList.add('is-filled');
            rating.append(star);
          }
          name.before(nameLine);
          nameLine.append(name, rating);
        }
        const button = card.querySelector('[data-review-visibility]');
        if (button) {
          const hidden = card.classList.contains('unpublished');
          const footer = document.createElement('div');
          footer.className = 'portfolio-soft-review-foot';
          const status = document.createElement('span');
          status.className = 'portfolio-soft-review-state';
          status.append(icon(hidden ? 'lock' : 'check'), document.createTextNode(hidden ? 'Скрыт с сайта' : 'На сайте'));
          button.prepend(icon(hidden ? 'upload' : 'lock'));
          button.before(footer);
          footer.append(status, button);
        }
      }
    };
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(works, { childList:true, subtree:true });
    observer.observe(reviews, { childList:true, subtree:true });
    observer.observe(view, { attributes:true, attributeFilter:['hidden'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
