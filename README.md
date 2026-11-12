# Scraping Skills

Agent skills (SKILL.md) for Claude Code and other agents that pull public web data from Google Maps, Amazon, Shopify, Zillow, Airbnb, Indeed, TikTok, Reddit and 46 more sources through Apify Actors and return named fields as JSON.

**69 skills** · 40 with a YouTube Short · last updated 2026-11-12 · MIT licence

## Quick start

```bash
git clone https://github.com/bolvein-firex/scraping-skills
mkdir -p ~/.claude/skills
cp -r scraping-skills/skills/google-maps-business-lead-and-email-finder ~/.claude/skills/
export APIFY_TOKEN=your_apify_token
```

Start Claude Code and ask for the job in plain words, for example "Google Maps leads with emails". Claude matches your request to the skill's description and follows its steps. To run a skill without an agent:

```bash
node ~/.claude/skills/google-maps-business-lead-and-email-finder/scripts/run.mjs            # uses references/example-input.json
node ~/.claude/skills/google-maps-business-lead-and-email-finder/scripts/run.mjs input.json # or your own input file
```

**What the first run costs:** the skill is free; the Actor bills your Apify account. Running the example as it ships (`max_results` = 20) costs about $0.42 on Apify's free plan ($0.40 to start a run with 4 GB of memory + $0.00099 per row), plus the run's platform usage. Each Actor's Pricing tab has its current price.

## Find a skill by job

### Lead generation

| Job | Skill | Returns |
|---|---|---|
| Apartments.com rental listing scraper | [apartments-com-rental-listing-and-floor-plan-scraper](skills/apartments-com-rental-listing-and-floor-plan-scraper/SKILL.md) | `name`, `address`, `priceMin`, `priceMax`, `priceCurrency` |
| Crexi commercial property listings scraper | [crexi-commercial-property-listings-and-pricing-extractor](skills/crexi-commercial-property-listings-and-pricing-extractor/SKILL.md) | `name`, `transaction_type`, `property_type`, `price`, `net_operating_income` |
| Google Maps leads with emails | [google-maps-business-lead-and-email-finder](skills/google-maps-business-lead-and-email-finder/SKILL.md) | `name`, `googleBusinessCategories`, `phoneNumber`, `email`, `reviewScore` |
| Google Maps search beyond 120 results | [google-maps-grid-based-market-saturation-scanner](skills/google-maps-grid-based-market-saturation-scanner/SKILL.md) | `name`, `categoryName`, `totalScore`, `reviewsCount`, `phone` |
| GulfTalent job listings across 16 middle east markets | [gulftalent-job-listings-across-16-middle-east-markets](skills/gulftalent-job-listings-across-16-middle-east-markets/SKILL.md) | `title`, `companyName`, `salaryMin`, `salaryMax`, `salaryCurrency` |
| Lowe's price, stock scraper | [lowe-s-price-stock-and-specification-scraper](skills/lowe-s-price-stock-and-specification-scraper/SKILL.md) | `title`, `brand`, `price`, `originalPrice`, `rating` |
| New Jersey business entity search | [new-jersey-business-registry-lookup-and-name-checker](skills/new-jersey-business-registry-lookup-and-name-checker/SKILL.md) | `businessName`, `entityTypeAbbr`, `entityTypeFull`, `city`, `incorporatedDate` |
| Threads public post, reply scraper | [threads-public-post-reply-and-profile-data-extractor](skills/threads-public-post-reply-and-profile-data-extractor/SKILL.md) | `authorUsername`, `postText`, `likeCount`, `commentCount`, `shareCount` |
| Find emails and phone numbers from a list of websites | [website-contact-page-email-and-phone-crawler](skills/website-contact-page-email-and-phone-crawler/SKILL.md) | `websiteUrl`, `status`, `emails`, `primaryEmail`, `phones` |

### E-commerce and price tracking

| Job | Skill | Returns |
|---|---|---|
| AliExpress product search export | [aliexpress-multi-region-search-store-and-review-scraper](skills/aliexpress-multi-region-search-store-and-review-scraper/SKILL.md) | `title`, `salePrice`, `originalPrice`, `discountPercent`, `rating` |
| Amazon deals grid | [amazon-deals-grid-tracker-by-category-and-discount](skills/amazon-deals-grid-tracker-by-category-and-discount/SKILL.md) | `asin`, `title`, `dealPrice`, `savingsPercent`, `averageRating` |
| Amazon price tracking | [amazon-multi-domain-product-price-and-detail-scraper](skills/amazon-multi-domain-product-price-and-detail-scraper/SKILL.md) | `title`, `asin`, `price`, `stars`, `reviewsCount` |
| Facebook Marketplace scraper | [facebook-marketplace-listing-and-price-extractor](skills/facebook-marketplace-listing-and-price-extractor/SKILL.md) | `title`, `price`, `city`, `state`, `locationText` |
| Goodreads book, author scraper | [goodreads-book-author-and-listopia-list-scraper](skills/goodreads-book-author-and-listopia-list-scraper/SKILL.md) | `title`, `primaryAuthor`, `averageRating`, `ratingsCount`, `publishedYear` |
| Google Shopping price comparison | [google-shopping-price-comparison-and-deal-finder](skills/google-shopping-price-comparison-and-deal-finder/SKILL.md) | `title`, `price`, `merchant`, `rating`, `reviewCount` |
| Pinterest trending topics scraper | [pinterest-trending-topics-and-shopping-category-scraper](skills/pinterest-trending-topics-and-shopping-category-scraper/SKILL.md) | `term`, `title`, `name`, `region`, `rank` |
| Scrape a Shopify store's products and prices | [shopify-store-catalog-and-pricing-extractor](skills/shopify-store-catalog-and-pricing-extractor/SKILL.md) | `title`, `price`, `compareAtPrice`, `available`, `vendor` |
| World Market product scraper | [world-market-product-scraper](skills/world-market-product-scraper/SKILL.md) | `title`, `price`, `originalPrice`, `saleBadge`, `rating` |

### Real estate

| Job | Skill | Returns |
|---|---|---|
| Walk Score for a list of addresses | [us-walkability-transit-and-bike-score-extractor](skills/us-walkability-transit-and-bike-score-extractor/SKILL.md) | `address`, `city`, `walkScore`, `transitScore`, `bikeScore` |
| Zillow for-sale, rental and sold listings | [zillow-for-sale-rent-and-sold-listing-extractor](skills/zillow-for-sale-rent-and-sold-listing-extractor/SKILL.md) | `address`, `price`, `soldPrice`, `beds`, `baths` |
| Zillow research county home value trend scraper | [zillow-research-county-home-value-trend-scraper](skills/zillow-research-county-home-value-trend-scraper/SKILL.md) | `countyName`, `stateCode`, `stateName`, `metro`, `latestValue` |

### Travel and short-term rentals

| Job | Skill | Returns |
|---|---|---|
| Airbnb price scraper | [airbnb-listing-price-and-location-finder](skills/airbnb-listing-price-and-location-finder/SKILL.md) | `name`, `nightlyPrice`, `totalPrice`, `rating`, `reviewCount` |
| Booking.com hotel prices for your dates | [booking-com-hotel-price-and-amenity-search-scraper](skills/booking-com-hotel-price-and-amenity-search-scraper/SKILL.md) | `name`, `price`, `pricePerNight`, `rating`, `reviewCount` |
| Google Flights fare scraper | [google-flights-fare-and-itinerary-filter-scraper](skills/google-flights-fare-and-itinerary-filter-scraper/SKILL.md) | `price`, `airline`, `departureAirport`, `departureTime`, `arrivalAirport` |
| Washington Trails Association hike | [washington-trails-association-hike-and-trip-report-finder](skills/washington-trails-association-hike-and-trip-report-finder/SKILL.md) | `trailName`, `region`, `lengthMiles`, `rating`, `reviewCount` |

### Jobs and salaries

| Job | Skill | Returns |
|---|---|---|
| Fiverr gig scraper | [fiverr-gig-and-seller-sitemap-directory-scraper](skills/fiverr-gig-and-seller-sitemap-directory-scraper/SKILL.md) | `title`, `gigUrl`, `priceMin`, `priceMax`, `rating` |
| Greenhouse ATS job board | [greenhouse-ats-job-board-lookup-by-company](skills/greenhouse-ats-job-board-lookup-by-company/SKILL.md) | `title`, `companySlug`, `companyName`, `location`, `departments` |
| Himalayas remote job | [himalayas-remote-job-finder-with-salary-and-tech-stack](skills/himalayas-remote-job-finder-with-salary-and-tech-stack/SKILL.md) | `title`, `company`, `salaryMin`, `salaryMax`, `salaryPeriod` |
| Indeed job scraper with salaries | [indeed-global-job-scraper-with-company-salary-reports](skills/indeed-global-job-scraper-with-company-salary-reports/SKILL.md) | `positionName`, `displayTitle`, `company`, `rating`, `salary` |
| Lever job board postings | [lever-job-board-postings-by-company-slug](skills/lever-job-board-postings-by-company-slug/SKILL.md) | `title`, `companySlug`, `location`, `salaryText`, `createdAt` |
| startup.jobs category scraper | [startup-jobs-category-and-keyword-job-scraper](skills/startup-jobs-category-and-keyword-job-scraper/SKILL.md) | `title`, `company`, `location`, `salary`, `postedAt` |
| We Work Remotely job listings scraper | [we-work-remotely-job-listings-and-salary-extractor](skills/we-work-remotely-job-listings-and-salary-extractor/SKILL.md) | `title`, `company`, `category`, `salary`, `postedAt` |
| Workday careers site job listings scraper | [workday-careers-site-job-listings-extractor](skills/workday-careers-site-job-listings-extractor/SKILL.md) | `title`, `tenant`, `location`, `postedOn` |

### Social media and trends

| Job | Skill | Returns |
|---|---|---|
| Dailymotion video discovery | [dailymotion-video-discovery-by-topic-and-channel](skills/dailymotion-video-discovery-by-topic-and-channel/SKILL.md) | `title`, `ownerUsername`, `views`, `likes`, `duration` |
| DeviantArt artwork search, gallery | [deviantart-artwork-search-gallery-and-trending-feed](skills/deviantart-artwork-search-gallery-and-trending-feed/SKILL.md) | `title`, `artistUsername`, `publishedAt`, `views`, `favourites` |
| Google image Search results scraper | [google-image-search-results-and-metadata-scraper](skills/google-image-search-results-and-metadata-scraper/SKILL.md) | `engine`, `title`, `sourceDomain`, `imageUrl`, `imageWidth` |
| Google News keyword scraper | [google-news-keyword-and-full-text-article-scraper](skills/google-news-keyword-and-full-text-article-scraper/SKILL.md) | `title`, `source`, `domain`, `publishedAt`, `url` |
| Export Google Trends data | [google-trends-interest-and-related-query-scraper](skills/google-trends-interest-and-related-query-scraper/SKILL.md) | `searchTerms`, `title`, `geoName`, `averageInterest`, `growthPercent` |
| NetEase Cloud Music song, chart scraper | [netease-cloud-music-song-chart-and-playlist-scraper](skills/netease-cloud-music-song-chart-and-playlist-scraper/SKILL.md) | `name`, `artist`, `album`, `rankPosition`, `playlistName` |
| Pexels stock media scraper | [pexels-stock-media-scraper](skills/pexels-stock-media-scraper/SKILL.md) | `title`, `photographerName`, `width`, `height`, `orientation` |
| Reddit posts and comments scraper | [reddit-multi-mode-scraper-for-posts-comments-and-profiles](skills/reddit-multi-mode-scraper-for-posts-comments-and-profiles/SKILL.md) | `subreddit_prefixed`, `title`, `author`, `score`, `commentCount` |
| Snapchat topic spotlight feed scraper | [snapchat-topic-spotlight-feed-and-content-tag-extractor](skills/snapchat-topic-spotlight-feed-and-content-tag-extractor/SKILL.md) | `creatorUsername`, `viewCount`, `uploadedAt`, `snapUrl` |
| StockTwits ticker sentiment | [stocktwits-ticker-sentiment-and-trending-symbol-feed](skills/stocktwits-ticker-sentiment-and-trending-symbol-feed/SKILL.md) | `symbol`, `title`, `sentimentScore`, `priceLast`, `pricePercentChange` |
| TikTok explore feed trending post scraper | [tiktok-explore-feed-trending-post-scraper](skills/tiktok-explore-feed-trending-post-scraper/SKILL.md) | `rank`, `marketRegion`, `playCount`, `likeCount`, `playsPerHour` |
| TikTok trending hashtags | [tiktok-hashtag-momentum-and-top-creator-tracker](skills/tiktok-hashtag-momentum-and-top-creator-tracker/SKILL.md) | `rankIndex`, `hashtagName`, `publishCnt`, `vv` |
| TikTok keyword search scraper | [tiktok-keyword-search-and-discovery-scraper](skills/tiktok-keyword-search-and-discovery-scraper/SKILL.md) | `rank`, `caption`, `playCount`, `likeCount`, `commentCount` |
| TikTok post scraper | [tiktok-post-and-slideshow-detail-scraper](skills/tiktok-post-and-slideshow-detail-scraper/SKILL.md) | `postUrl`, `caption`, `playCount`, `likeCount`, `commentCount` |
| TikTok verified mention | [tiktok-verified-mention-tracker](skills/tiktok-verified-mention-tracker/SKILL.md) | `targetUsername`, `postUrl`, `author.followerCount`, `playCount`, `likeCount` |
| Unsplash photo search | [unsplash-photo-search-by-topic-collection-and-creator](skills/unsplash-photo-search-by-topic-collection-and-creator/SKILL.md) | `title`, `photographerName`, `orientation`, `width`, `likes` |
| X broadcast viewer history scraper | [x-broadcast-viewer-history-and-replay-link-scraper](skills/x-broadcast-viewer-history-and-replay-link-scraper/SKILL.md) | `title`, `state`, `broadcaster.username`, `viewersNow`, `viewersTotal` |
| X post, reply | [x-post-reply-and-profile-lookup-by-link-or-id](skills/x-post-reply-and-profile-lookup-by-link-or-id/SKILL.md) | `text`, `author.username`, `createdAt`, `likeCount`, `viewCount` |
| YouTube caption scraper | [youtube-caption-and-whisper-ai-transcript-extractor](skills/youtube-caption-and-whisper-ai-transcript-extractor/SKILL.md) | `video_id`, `title`, `channel_name`, `publishedAt`, `transcript_language` |
| YouTube channel video catalog scraper | [youtube-channel-video-catalog-and-profile-scraper](skills/youtube-channel-video-catalog-and-profile-scraper/SKILL.md) | `title`, `viewCount`, `duration`, `publishedTimeText`, `url` |
| YouTube community tab post scraper | [youtube-community-tab-post-and-poll-scraper](skills/youtube-community-tab-post-and-poll-scraper/SKILL.md) | `channelName`, `contentText`, `publishedAt`, `likeCount`, `commentCount` |
| YouTube search results scraper | [youtube-search-results-and-entity-type-scraper](skills/youtube-search-results-and-entity-type-scraper/SKILL.md) | `title`, `channelName`, `viewCount`, `publishedAt`, `publishedTimeText` |
| YouTube trending feed scraper | [youtube-trending-feed-extractor-by-category-and-market](skills/youtube-trending-feed-extractor-by-category-and-market/SKILL.md) | `sourceName`, `title`, `channelName`, `chartViewCount`, `viewCount` |
| YouTube video comment scraper | [youtube-video-comment-and-reply-thread-scraper](skills/youtube-video-comment-and-reply-thread-scraper/SKILL.md) | `authorName`, `text`, `likeCount`, `replyCount`, `isHearted` |
| YouTube video metadata scraper | [youtube-video-metadata-and-chapter-extractor](skills/youtube-video-metadata-and-chapter-extractor/SKILL.md) | `url`, `title`, `viewCount`, `likeCount`, `commentCount` |

### Reviews

| Job | Skill | Returns |
|---|---|---|
| Amazon review scraper | [amazon-customer-review-and-rating-summary-scraper](skills/amazon-customer-review-and-rating-summary-scraper/SKILL.md) | `productAsin`, `ratingScore`, `reviewTitle`, `reviewDescription`, `isVerified` |
| Amazon reviews across marketplaces | [amazon-review-aggregates-and-extended-history-scraper](skills/amazon-review-aggregates-and-extended-history-scraper/SKILL.md) | `productAsin`, `ratingScore`, `reviewTitle`, `reviewDescription`, `isVerified` |
| Steam game reviews scraper | [steam-game-reviews-and-playtime-extractor](skills/steam-game-reviews-and-playtime-extractor/SKILL.md) | `gameTitle`, `rating`, `reviewText`, `authorName`, `authorPlaytimeForever` |

### Other public data

| Job | Skill | Returns |
|---|---|---|
| Decrypt crypto news | [decrypt-crypto-news-finder-by-category-and-keyword](skills/decrypt-crypto-news-finder-by-category-and-keyword/SKILL.md) | `title`, `authors`, `category`, `publishedAt`, `readingTimeMinutes` |
| Domain-Scoped site scraper | [domain-scoped-site-crawler-for-markdown-datasets](skills/domain-scoped-site-crawler-for-markdown-datasets/SKILL.md) | `url`, `title`, `depth`, `wordCount`, `httpStatusCode` |
| ESPN scores, standings, teams | [espn-scores-standings-teams-and-news-by-league](skills/espn-scores-standings-teams-and-news-by-league/SKILL.md) | `mode`, `sport`, `league`, `homeScore`, `awayScore` |
| Google Scholar paper scraper | [google-scholar-paper-and-citation-search-scraper](skills/google-scholar-paper-and-citation-search-scraper/SKILL.md) | `title`, `name`, `authors`, `year`, `publication` |
| MLB teams, player search | [mlb-teams-player-search-and-season-schedule-lookup](skills/mlb-teams-player-search-and-season-schedule-lookup/SKILL.md) | `teamName`, `playerName`, `eventName`, `homeTeam`, `awayTeam` |
| Multi-League season results | [multi-league-season-results-and-team-lookup](skills/multi-league-season-results-and-team-lookup/SKILL.md) | `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `matchDate` |
| OP.GG league of legends tier list | [op-gg-league-of-legends-tier-list-and-win-rate-tracker](skills/op-gg-league-of-legends-tier-list-and-win-rate-tracker/SKILL.md) | `championName`, `tier`, `tierNumber`, `tierRank`, `rankChange` |
| SofaScore live scores, standings | [sofascore-live-scores-standings-and-team-search-data](skills/sofascore-live-scores-standings-and-team-search-data/SKILL.md) | `name`, `homeTeam`, `awayTeam`, `homeScore`, `awayScore` |

## All skills

Output fields are the Actor's own column names, read from its dataset schema at publish time.

| # | Skill | Platform | Output fields | Short |
|---|---|---|---|---|
| 1 | [Airbnb Listing Price & Location Finder](skills/airbnb-listing-price-and-location-finder/SKILL.md) | Airbnb | `name`, `nightlyPrice`, `totalPrice`, `rating`, `reviewCount` | [Watch](https://www.youtube.com/shorts/aVEDRMB3vsU) |
| 2 | [AliExpress Multi-Region Search, Store & Review Scraper](skills/aliexpress-multi-region-search-store-and-review-scraper/SKILL.md) | AliExpress | `title`, `salePrice`, `originalPrice`, `discountPercent`, `rating` | [Watch](https://www.youtube.com/shorts/lY2MQAk6oJA) |
| 3 | [Amazon Customer Review & Rating Summary Scraper](skills/amazon-customer-review-and-rating-summary-scraper/SKILL.md) | Amazon | `productAsin`, `ratingScore`, `reviewTitle`, `reviewDescription`, `isVerified` | [Watch](https://www.youtube.com/shorts/WhVOks5q4MU) |
| 4 | [Amazon Deals Grid Tracker by Category & Discount](skills/amazon-deals-grid-tracker-by-category-and-discount/SKILL.md) | Amazon | `asin`, `title`, `dealPrice`, `savingsPercent`, `averageRating` | [Watch](https://www.youtube.com/shorts/rbaQJ__OtNg) |
| 5 | [Amazon Multi-Domain Product Price & Detail Scraper](skills/amazon-multi-domain-product-price-and-detail-scraper/SKILL.md) | Amazon | `title`, `asin`, `price`, `stars`, `reviewsCount` | [Watch](https://www.youtube.com/shorts/SqsDoB0jyD8) |
| 6 | [Amazon Review Aggregates & Extended History Scraper](skills/amazon-review-aggregates-and-extended-history-scraper/SKILL.md) | Amazon | `productAsin`, `ratingScore`, `reviewTitle`, `reviewDescription`, `isVerified` |  |
| 7 | [Apartments.com Rental Listing & Floor Plan Scraper](skills/apartments-com-rental-listing-and-floor-plan-scraper/SKILL.md) | Apartments.com | `name`, `address`, `priceMin`, `priceMax`, `priceCurrency` | [Watch](https://www.youtube.com/shorts/YvLah5jotOg) |
| 8 | [Booking.com Hotel Price & Amenity Search Scraper](skills/booking-com-hotel-price-and-amenity-search-scraper/SKILL.md) | Booking.com | `name`, `price`, `pricePerNight`, `rating`, `reviewCount` | [Watch](https://www.youtube.com/shorts/jQWhZPI54SI) |
| 9 | [Crexi Commercial Property Listings & Pricing Extractor](skills/crexi-commercial-property-listings-and-pricing-extractor/SKILL.md) | Crexi | `name`, `transaction_type`, `property_type`, `price`, `net_operating_income` | [Watch](https://www.youtube.com/shorts/Zjhi7zCDPpU) |
| 10 | [Dailymotion Video Discovery by Topic & Channel](skills/dailymotion-video-discovery-by-topic-and-channel/SKILL.md) | Dailymotion | `title`, `ownerUsername`, `views`, `likes`, `duration` |  |
| 11 | [Decrypt Crypto News Finder by Category & Keyword](skills/decrypt-crypto-news-finder-by-category-and-keyword/SKILL.md) | Decrypt | `title`, `authors`, `category`, `publishedAt`, `readingTimeMinutes` | [Watch](https://www.youtube.com/shorts/9wMkmbVIg3U) |
| 12 | [DeviantArt Artwork Search, Gallery & Trending Feed](skills/deviantart-artwork-search-gallery-and-trending-feed/SKILL.md) | DeviantArt | `title`, `artistUsername`, `publishedAt`, `views`, `favourites` |  |
| 13 | [Domain-Scoped Site Crawler for Markdown Datasets](skills/domain-scoped-site-crawler-for-markdown-datasets/SKILL.md) | Domain-Scoped | `url`, `title`, `depth`, `wordCount`, `httpStatusCode` |  |
| 14 | [ESPN Scores, Standings, Teams & News by League](skills/espn-scores-standings-teams-and-news-by-league/SKILL.md) | ESPN | `mode`, `sport`, `league`, `homeScore`, `awayScore` |  |
| 15 | [Facebook Marketplace Listing & Price Extractor](skills/facebook-marketplace-listing-and-price-extractor/SKILL.md) | Facebook Marketplace | `title`, `price`, `city`, `state`, `locationText` |  |
| 16 | [Fiverr Gig & Seller Sitemap Directory Scraper](skills/fiverr-gig-and-seller-sitemap-directory-scraper/SKILL.md) | Fiverr | `title`, `gigUrl`, `priceMin`, `priceMax`, `rating` | [Watch](https://www.youtube.com/shorts/JsVKl5TOvJE) |
| 17 | [Goodreads Book, Author & Listopia List Scraper](skills/goodreads-book-author-and-listopia-list-scraper/SKILL.md) | Goodreads | `title`, `primaryAuthor`, `averageRating`, `ratingsCount`, `publishedYear` |  |
| 18 | [Google Flights Fare & Itinerary Filter Scraper](skills/google-flights-fare-and-itinerary-filter-scraper/SKILL.md) | Google Flights | `price`, `airline`, `departureAirport`, `departureTime`, `arrivalAirport` | [Watch](https://www.youtube.com/shorts/ntNLhXTe4VE) |
| 19 | [Google Image Search Results & Metadata Scraper](skills/google-image-search-results-and-metadata-scraper/SKILL.md) | Google Search | `engine`, `title`, `sourceDomain`, `imageUrl`, `imageWidth` |  |
| 20 | [Google Maps Business Lead & Email Finder](skills/google-maps-business-lead-and-email-finder/SKILL.md) | Google Maps | `name`, `googleBusinessCategories`, `phoneNumber`, `email`, `reviewScore` | [Watch](https://www.youtube.com/shorts/ofD2844kDPQ) |
| 21 | [Google Maps Grid-Based Market Saturation Scanner](skills/google-maps-grid-based-market-saturation-scanner/SKILL.md) | Google Maps | `name`, `categoryName`, `totalScore`, `reviewsCount`, `phone` | [Watch](https://www.youtube.com/shorts/uom3-Fy_xFk) |
| 22 | [Google News Keyword & Full-Text Article Scraper](skills/google-news-keyword-and-full-text-article-scraper/SKILL.md) | Google News | `title`, `source`, `domain`, `publishedAt`, `url` | [Watch](https://www.youtube.com/shorts/Bjy20zqqfI0) |
| 23 | [Google Scholar Paper & Citation Search Scraper](skills/google-scholar-paper-and-citation-search-scraper/SKILL.md) | Google Scholar | `title`, `name`, `authors`, `year`, `publication` | [Watch](https://www.youtube.com/shorts/jtGItT4Ff78) |
| 24 | [Google Shopping Price Comparison & Deal Finder](skills/google-shopping-price-comparison-and-deal-finder/SKILL.md) | Google Shopping | `title`, `price`, `merchant`, `rating`, `reviewCount` |  |
| 25 | [Google Trends Interest & Related Query Scraper](skills/google-trends-interest-and-related-query-scraper/SKILL.md) | Google Trends | `searchTerms`, `title`, `geoName`, `averageInterest`, `growthPercent` | [Watch](https://www.youtube.com/shorts/gDZBpA25UB8) |
| 26 | [Greenhouse ATS Job Board Lookup by Company](skills/greenhouse-ats-job-board-lookup-by-company/SKILL.md) | Greenhouse | `title`, `companySlug`, `companyName`, `location`, `departments` |  |
| 27 | [GulfTalent Job Listings Across 16 Middle East Markets](skills/gulftalent-job-listings-across-16-middle-east-markets/SKILL.md) | GulfTalent | `title`, `companyName`, `salaryMin`, `salaryMax`, `salaryCurrency` |  |
| 28 | [Himalayas Remote Job Finder with Salary & Tech Stack](skills/himalayas-remote-job-finder-with-salary-and-tech-stack/SKILL.md) | Himalayas | `title`, `company`, `salaryMin`, `salaryMax`, `salaryPeriod` | [Watch](https://www.youtube.com/shorts/OwuknGY8obI) |
| 29 | [Indeed Global Job Scraper with Company Salary Reports](skills/indeed-global-job-scraper-with-company-salary-reports/SKILL.md) | Indeed | `positionName`, `displayTitle`, `company`, `rating`, `salary` | [Watch](https://www.youtube.com/shorts/33f3pNEO6Oc) |
| 30 | [Lever Job Board Postings by Company Slug](skills/lever-job-board-postings-by-company-slug/SKILL.md) | Lever | `title`, `companySlug`, `location`, `salaryText`, `createdAt` | [Watch](https://www.youtube.com/shorts/Fj8lsPbASu0) |
| 31 | [Lowe's Price, Stock & Specification Scraper](skills/lowe-s-price-stock-and-specification-scraper/SKILL.md) | Lowe's | `title`, `brand`, `price`, `originalPrice`, `rating` |  |
| 32 | [MLB Teams, Player Search & Season Schedule Lookup](skills/mlb-teams-player-search-and-season-schedule-lookup/SKILL.md) | MLB | `teamName`, `playerName`, `eventName`, `homeTeam`, `awayTeam` | [Watch](https://www.youtube.com/shorts/4VOTofCYCmk) |
| 33 | [Multi-League Season Results & Team Lookup](skills/multi-league-season-results-and-team-lookup/SKILL.md) | Multi-League | `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `matchDate` | [Watch](https://www.youtube.com/shorts/-_kZpsDWfXw) |
| 34 | [NetEase Cloud Music Song, Chart & Playlist Scraper](skills/netease-cloud-music-song-chart-and-playlist-scraper/SKILL.md) | NetEase Cloud Music | `name`, `artist`, `album`, `rankPosition`, `playlistName` | [Watch](https://www.youtube.com/shorts/k3LbS3Z4Eqc) |
| 35 | [New Jersey Business Registry Lookup & Name Checker](skills/new-jersey-business-registry-lookup-and-name-checker/SKILL.md) | NJ business registry | `businessName`, `entityTypeAbbr`, `entityTypeFull`, `city`, `incorporatedDate` | [Watch](https://www.youtube.com/shorts/tGV77V4rMqk) |
| 36 | [OP.GG League of Legends Tier List & Win Rate Tracker](skills/op-gg-league-of-legends-tier-list-and-win-rate-tracker/SKILL.md) | OP.GG | `championName`, `tier`, `tierNumber`, `tierRank`, `rankChange` |  |
| 37 | [Pexels Stock Media Scraper](skills/pexels-stock-media-scraper/SKILL.md) | Pexels | `title`, `photographerName`, `width`, `height`, `orientation` | [Watch](https://www.youtube.com/shorts/8eZdJt-fTS0) |
| 38 | [Pinterest Trending Topics & Shopping Category Scraper](skills/pinterest-trending-topics-and-shopping-category-scraper/SKILL.md) | Pinterest | `term`, `title`, `name`, `region`, `rank` | [Watch](https://www.youtube.com/shorts/14Wbs-96RPg) |
| 39 | [Reddit Multi-Mode Scraper for Posts, Comments & Profiles](skills/reddit-multi-mode-scraper-for-posts-comments-and-profiles/SKILL.md) | Reddit | `subreddit_prefixed`, `title`, `author`, `score`, `commentCount` | [Watch](https://www.youtube.com/shorts/3TmxkUNaB0U) |
| 40 | [Shopify Store Catalog & Pricing Extractor](skills/shopify-store-catalog-and-pricing-extractor/SKILL.md) | Shopify | `title`, `price`, `compareAtPrice`, `available`, `vendor` | [Watch](https://www.youtube.com/shorts/398NV7q-K6w) |
| 41 | [Snapchat Topic Spotlight Feed & Content Tag Extractor](skills/snapchat-topic-spotlight-feed-and-content-tag-extractor/SKILL.md) | Snapchat | `creatorUsername`, `viewCount`, `uploadedAt`, `snapUrl` |  |
| 42 | [SofaScore Live Scores, Standings & Team Search Data](skills/sofascore-live-scores-standings-and-team-search-data/SKILL.md) | SofaScore | `name`, `homeTeam`, `awayTeam`, `homeScore`, `awayScore` | [Watch](https://www.youtube.com/shorts/qMmkq9VlH8k) |
| 43 | [startup.jobs Category & Keyword Job Scraper](skills/startup-jobs-category-and-keyword-job-scraper/SKILL.md) | startup.jobs | `title`, `company`, `location`, `salary`, `postedAt` | [Watch](https://www.youtube.com/shorts/SOMB7J9-Iak) |
| 44 | [Steam Game Reviews & Playtime Extractor](skills/steam-game-reviews-and-playtime-extractor/SKILL.md) | Steam | `gameTitle`, `rating`, `reviewText`, `authorName`, `authorPlaytimeForever` | [Watch](https://www.youtube.com/shorts/SPN2mTIbS5M) |
| 45 | [StockTwits Ticker Sentiment & Trending Symbol Feed](skills/stocktwits-ticker-sentiment-and-trending-symbol-feed/SKILL.md) | StockTwits | `symbol`, `title`, `sentimentScore`, `priceLast`, `pricePercentChange` |  |
| 46 | [Threads Public Post, Reply & Profile Data Extractor](skills/threads-public-post-reply-and-profile-data-extractor/SKILL.md) | Threads | `authorUsername`, `postText`, `likeCount`, `commentCount`, `shareCount` | [Watch](https://www.youtube.com/shorts/VrUu5YRxyMo) |
| 47 | [TikTok Explore Feed Trending Post Scraper](skills/tiktok-explore-feed-trending-post-scraper/SKILL.md) | TikTok | `rank`, `marketRegion`, `playCount`, `likeCount`, `playsPerHour` |  |
| 48 | [TikTok Hashtag Momentum & Top Creator Tracker](skills/tiktok-hashtag-momentum-and-top-creator-tracker/SKILL.md) | TikTok | `rankIndex`, `hashtagName`, `publishCnt`, `vv` | [Watch](https://www.youtube.com/shorts/C3buLaYtlGg) |
| 49 | [TikTok Keyword Search & Discovery Scraper](skills/tiktok-keyword-search-and-discovery-scraper/SKILL.md) | TikTok | `rank`, `caption`, `playCount`, `likeCount`, `commentCount` |  |
| 50 | [TikTok Post & Slideshow Detail Scraper](skills/tiktok-post-and-slideshow-detail-scraper/SKILL.md) | TikTok | `postUrl`, `caption`, `playCount`, `likeCount`, `commentCount` |  |
| 51 | [TikTok Verified Mention Tracker](skills/tiktok-verified-mention-tracker/SKILL.md) | TikTok | `targetUsername`, `postUrl`, `author.followerCount`, `playCount`, `likeCount` | [Watch](https://www.youtube.com/shorts/06JYF6pVjgE) |
| 52 | [Unsplash Photo Search by Topic, Collection & Creator](skills/unsplash-photo-search-by-topic-collection-and-creator/SKILL.md) | Unsplash | `title`, `photographerName`, `orientation`, `width`, `likes` |  |
| 53 | [US Walkability, Transit & Bike Score Extractor](skills/us-walkability-transit-and-bike-score-extractor/SKILL.md) | Walk Score | `address`, `city`, `walkScore`, `transitScore`, `bikeScore` | [Watch](https://www.youtube.com/shorts/yCT9c3LRopU) |
| 54 | [Washington Trails Association Hike & Trip Report Finder](skills/washington-trails-association-hike-and-trip-report-finder/SKILL.md) | Washington Trails Association | `trailName`, `region`, `lengthMiles`, `rating`, `reviewCount` | [Watch](https://www.youtube.com/shorts/0sgh1HcSZeM) |
| 55 | [We Work Remotely Job Listings & Salary Extractor](skills/we-work-remotely-job-listings-and-salary-extractor/SKILL.md) | We Work Remotely | `title`, `company`, `category`, `salary`, `postedAt` | [Watch](https://www.youtube.com/shorts/aJWSYR7WvXE) |
| 56 | [Website Contact Page Email & Phone Crawler](skills/website-contact-page-email-and-phone-crawler/SKILL.md) | Any website | `websiteUrl`, `status`, `emails`, `primaryEmail`, `phones` | [Watch](https://www.youtube.com/shorts/MHdeuiVwMZA) |
| 57 | [Workday Careers Site Job Listings Extractor](skills/workday-careers-site-job-listings-extractor/SKILL.md) | Workday | `title`, `tenant`, `location`, `postedOn` | [Watch](https://www.youtube.com/shorts/cP29fxKOpvM) |
| 58 | [World Market Product Scraper](skills/world-market-product-scraper/SKILL.md) | World Market | `title`, `price`, `originalPrice`, `saleBadge`, `rating` |  |
| 59 | [X Broadcast Viewer History & Replay Link Scraper](skills/x-broadcast-viewer-history-and-replay-link-scraper/SKILL.md) | X | `title`, `state`, `broadcaster.username`, `viewersNow`, `viewersTotal` |  |
| 60 | [X Post, Reply & Profile Lookup by Link or ID](skills/x-post-reply-and-profile-lookup-by-link-or-id/SKILL.md) | Twitter | `text`, `author.username`, `createdAt`, `likeCount`, `viewCount` |  |
| 61 | [YouTube Caption & Whisper AI Transcript Extractor](skills/youtube-caption-and-whisper-ai-transcript-extractor/SKILL.md) | YouTube | `video_id`, `title`, `channel_name`, `publishedAt`, `transcript_language` |  |
| 62 | [YouTube Channel Video Catalog & Profile Scraper](skills/youtube-channel-video-catalog-and-profile-scraper/SKILL.md) | YouTube | `title`, `viewCount`, `duration`, `publishedTimeText`, `url` |  |
| 63 | [YouTube Community Tab Post & Poll Scraper](skills/youtube-community-tab-post-and-poll-scraper/SKILL.md) | YouTube | `channelName`, `contentText`, `publishedAt`, `likeCount`, `commentCount` |  |
| 64 | [YouTube Search Results & Entity Type Scraper](skills/youtube-search-results-and-entity-type-scraper/SKILL.md) | YouTube | `title`, `channelName`, `viewCount`, `publishedAt`, `publishedTimeText` |  |
| 65 | [YouTube Trending Feed Extractor by Category & Market](skills/youtube-trending-feed-extractor-by-category-and-market/SKILL.md) | YouTube | `sourceName`, `title`, `channelName`, `chartViewCount`, `viewCount` |  |
| 66 | [YouTube Video Comment & Reply Thread Scraper](skills/youtube-video-comment-and-reply-thread-scraper/SKILL.md) | YouTube | `authorName`, `text`, `likeCount`, `replyCount`, `isHearted` |  |
| 67 | [YouTube Video Metadata & Chapter Extractor](skills/youtube-video-metadata-and-chapter-extractor/SKILL.md) | YouTube | `url`, `title`, `viewCount`, `likeCount`, `commentCount` |  |
| 68 | [Zillow For-Sale, Rent & Sold Listing Extractor](skills/zillow-for-sale-rent-and-sold-listing-extractor/SKILL.md) | Zillow | `address`, `price`, `soldPrice`, `beds`, `baths` | [Watch](https://www.youtube.com/shorts/bNjKOMdRlSY) |
| 69 | [Zillow Research County Home Value Trend Scraper](skills/zillow-research-county-home-value-trend-scraper/SKILL.md) | Zillow | `countyName`, `stateCode`, `stateName`, `metro`, `latestValue` | [Watch](https://www.youtube.com/shorts/ZHpo1ej5zvc) |

## FAQ

### What is an agent skill?
A folder with a `SKILL.md` file: YAML frontmatter (`name`, `description`) followed by instructions, plus optional scripts and reference files. The agent reads the description and loads the rest only when a request matches it.

### How do skills work in Claude Code?
Put a skill folder in `~/.claude/skills/` (all your projects) or `.claude/skills/` inside a repository (that project only). Claude Code picks up the skills when it starts and uses one when your request matches its description. You can also name the skill in your request.

### Do they work with other agents?
Yes. `SKILL.md` is plain markdown, and the run step is a `curl` call or `node scripts/run.mjs` (Node 18 or newer), so any agent that can read files and run a shell command can follow it.

### Are these skills free?
Yes. The skills are MIT-licensed. Each one calls a public Apify Actor on your own Apify account, so the only cost is that Actor's usage.

### Do I need an Apify account?
Yes. Set `APIFY_TOKEN` to an API token from https://console.apify.com/settings/integrations. Apify's free plan includes a monthly usage credit, which is enough for small test runs.

### How much does a run cost?
It depends on the Actor's pricing (per result, per event or per compute unit) and on how many rows you ask for. The Actor's Pricing tab shows the current price; keep the limit in the example input small for a first run.

### Do I need an MCP server?
No. Each skill calls the Apify REST API directly. If you already use Apify's MCP server, the Actor IDs in each skill work there too.

## How a skill is laid out

```
skills/<skill-name>/
  SKILL.md                      # frontmatter + when to use, what it returns, inputs, how to run
  scripts/run.mjs               # minimal Node runner (APIFY_TOKEN; the Actor ID is built in)
  references/example-input.json # starter input
  references/input-schema.json  # the Actor's full input schema
  references/output-fields.json # the Actor's declared output fields
```

## Related

- n8n workflows for the same Actors: https://github.com/bolvein-firex/scraping-n8n-workflows
- Short video breakdowns: https://www.youtube.com/@ScraperFinder
- Step-by-step tutorials on dev.to: https://dev.to/scraperfinder/series/46235

## Contributing

Missing a site? [Request a skill](https://github.com/bolvein-firex/scraping-skills/issues/new/choose). Questions go to [Discussions](https://github.com/bolvein-firex/scraping-skills/discussions). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Guardrails

Public data only. Do not use these skills for private, login-protected or paywalled data. Respect robots.txt, site terms and local law.

## License

MIT
