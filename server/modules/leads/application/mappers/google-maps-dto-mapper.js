export function mapGoogleMapsPlaceMatch(place) {
  if (!place) {
    return null
  }

  return {
    provider: place.provider || 'google-maps',
    sourceUrl: place.url || (place.googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${place.googlePlaceId}` : ''),
    query: place.query || '',
    queryLabel: place.queryLabel || 'company',
    name: place.title,
    address: place.address,
    phone: place.phone,
    website: place.url,
    rating: place.googleRating,
    reviewCount: place.googleReviewCount || 0,
    businessStatus: place.googleBusinessStatus,
    primaryType: place.googlePrimaryType || '',
    types: place.googleTypes,
    placeId: place.googlePlaceId,
    location: place.geo || null
  }
}
