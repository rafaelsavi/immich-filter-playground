package immich

import "time"

type (
	AssetType       string
	AssetOrder      string
	AssetVisibility string
)

const (
	ImageType AssetType = "IMAGE"
	VideoType AssetType = "VIDEO"
	AudioType AssetType = "AUDIO"
	OtherType AssetType = "OTHER"

	Asc  AssetOrder = "asc"
	Desc AssetOrder = "desc"

	Archive  AssetVisibility = "archive"
	Hidden   AssetVisibility = "hidden"
	Locked   AssetVisibility = "locked"
	Timeline AssetVisibility = "timeline"

	SearchRandomEndpoint   = "api/search/random"
	SearchMetadataEndpoint = "api/search/metadata"
)

type ExifInfo struct {
	City             string    `json:"city"`
	Country          string    `json:"country"`
	State            string    `json:"state"`
	DateTimeOriginal time.Time `json:"dateTimeOriginal"`
	Description      string    `json:"description"`
	ExifImageHeight  int       `json:"exifImageHeight"`
	ExifImageWidth   int       `json:"exifImageWidth"`
	ExposureTime     string    `json:"exposureTime"`
	FileSizeInByte   int64     `json:"fileSizeInByte"`
	FNumber          float64   `json:"fNumber"`
	FocalLength      float64   `json:"focalLength"`
	Iso              int       `json:"iso"`
	Latitude         float64   `json:"latitude"`
	Longitude        float64   `json:"longitude"`
	LensModel        string    `json:"lensModel"`
	Make             string    `json:"make"`
	Model            string    `json:"model"`
	ModifyDate       time.Time `json:"modifyDate"`
	Orientation      string    `json:"orientation"`
	Rating           int       `json:"rating"`
	TimeZone         string    `json:"timeZone"`
}

type Person struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	BirthDate string `json:"birthDate,omitempty"`
	IsHidden  bool   `json:"isHidden,omitempty"`
}

type Tag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Value string `json:"value"`
	Color string `json:"color,omitempty"`
}

type Album struct {
	ID         string `json:"id"`
	AlbumName  string `json:"albumName"`
	AssetCount int    `json:"assetCount"`
	Shared     bool   `json:"shared"`
}

type Asset struct {
	ID               string          `json:"id"`
	Type             AssetType       `json:"type"`
	OriginalFileName string          `json:"originalFileName"`
	OriginalMimeType string          `json:"originalMimeType"`
	LocalDateTime    time.Time       `json:"localDateTime"`
	IsFavorite       bool            `json:"isFavorite"`
	IsArchived       bool            `json:"isArchived"`
	IsTrashed        bool            `json:"isTrashed"`
	Duration         string          `json:"duration"`
	Visibility       AssetVisibility `json:"visibility"`
	ExifInfo         ExifInfo        `json:"exifInfo"`
	People           []Person        `json:"people"`
	Tags             []Tag           `json:"tags"`
}

type StringFilter struct {
	Eq    string   `json:"eq,omitempty,omitzero"`
	In    []string `json:"in,omitempty,omitzero"`
	Ne    string   `json:"ne,omitempty,omitzero"`
	NotIn []string `json:"notIn,omitempty,omitzero"`
}

type StringFilterNullable struct {
	Eq    string   `json:"eq,omitempty,omitzero"`
	In    []string `json:"in,omitempty,omitzero"`
	Ne    string   `json:"ne,omitempty,omitzero"`
	NotIn []string `json:"notIn,omitempty,omitzero"`
}

type BoolFilter struct {
	Eq *bool `json:"eq,omitempty"`
}

type DateFilter struct {
	Eq  time.Time `json:"eq,omitzero"`
	Gt  time.Time `json:"gt,omitzero"`
	Gte time.Time `json:"gte,omitzero"`
	Lt  time.Time `json:"lt,omitzero"`
	Lte time.Time `json:"lte,omitzero"`
	Ne  time.Time `json:"ne,omitzero"`
}

type IDsFilter struct {
	All  []string `json:"all,omitempty,omitzero"`
	Any  []string `json:"any,omitempty,omitzero"`
	None []string `json:"none,omitempty,omitzero"`
}

type StringPatternFilter struct {
	EndsWith   string   `json:"endsWith,omitempty,omitzero"`
	Eq         string   `json:"eq,omitempty,omitzero"`
	In         []string `json:"in,omitempty,omitzero"`
	Like       string   `json:"like,omitempty,omitzero"`
	Ne         string   `json:"ne,omitempty,omitzero"`
	NotIn      []string `json:"notIn,omitempty,omitzero"`
	NotLike    string   `json:"notLike,omitempty,omitzero"`
	StartsWith string   `json:"startsWith,omitempty,omitzero"`
}

type NumberFilter struct {
	Eq    float64   `json:"eq,omitempty,omitzero"`
	Gt    float64   `json:"gt,omitempty,omitzero"`
	Gte   float64   `json:"gte,omitempty,omitzero"`
	In    []float64 `json:"in,omitempty,omitzero"`
	Lt    float64   `json:"lt,omitempty,omitzero"`
	Lte   float64   `json:"lte,omitempty,omitzero"`
	Ne    float64   `json:"ne,omitempty,omitzero"`
	NotIn []float64 `json:"notIn,omitempty,omitzero"`
}

type NumberFilterNullable struct {
	Eq    float64   `json:"eq,omitempty,omitzero"`
	Gt    float64   `json:"gt,omitempty,omitzero"`
	Gte   float64   `json:"gte,omitempty,omitzero"`
	In    []float64 `json:"in,omitempty,omitzero"`
	Lt    float64   `json:"lt,omitempty,omitzero"`
	Lte   float64   `json:"lte,omitempty,omitzero"`
	Ne    float64   `json:"ne,omitempty,omitzero"`
	NotIn []float64 `json:"notIn,omitempty,omitzero"`
}

type IDFilter struct {
	Eq string `json:"eq,omitempty,omitzero"`
	Ne string `json:"ne,omitempty,omitzero"`
}

type IDFilterNullable struct {
	Eq string `json:"eq,omitempty,omitzero"`
	Ne string `json:"ne,omitempty,omitzero"`
}

type StringSimilarityFilter struct {
	Matches string `json:"matches,omitempty,omitzero"`
}

type FilterAssetVisibility struct {
	Eq    AssetVisibility   `json:"eq,omitempty,omitzero"`
	In    []AssetVisibility `json:"in,omitempty,omitzero"`
	Ne    AssetVisibility   `json:"ne,omitempty,omitzero"`
	NotIn []AssetVisibility `json:"notIn,omitempty,omitzero"`
}

type FilterAssetType struct {
	Eq    AssetType   `json:"eq,omitempty,omitzero"`
	In    []AssetType `json:"in,omitempty,omitzero"`
	Ne    AssetType   `json:"ne,omitempty,omitzero"`
	NotIn []AssetType `json:"notIn,omitempty,omitzero"`
}

type SearchOrder struct {
	Direction AssetOrder `json:"direction,omitempty,omitzero"`
	Field     string     `json:"field,omitempty,omitzero"`
}

type SearchFilterBranch struct {
	AlbumIDs         IDsFilter              `json:"albumIds,omitzero"`
	Checksum         StringFilter           `json:"checksum,omitzero"`
	City             StringFilterNullable   `json:"city,omitzero"`
	Country          StringFilterNullable   `json:"country,omitzero"`
	CreatedAt        DateFilter             `json:"createdAt,omitzero"`
	Description      StringPatternFilter    `json:"description,omitzero"`
	EncodedVideoPath StringFilter           `json:"encodedVideoPath,omitzero"`
	FileSizeInBytes  NumberFilter           `json:"fileSizeInBytes,omitzero"`
	HasAlbums        BoolFilter             `json:"hasAlbums,omitzero"`
	HasPeople        BoolFilter             `json:"hasPeople,omitzero"`
	HasTags          BoolFilter             `json:"hasTags,omitzero"`
	ID               IDFilter               `json:"id,omitzero"`
	IsEncoded        BoolFilter             `json:"isEncoded,omitzero"`
	IsFavorite       BoolFilter             `json:"isFavorite,omitzero"`
	IsMotion         BoolFilter             `json:"isMotion,omitzero"`
	IsOffline        BoolFilter             `json:"isOffline,omitzero"`
	LensModel        StringFilterNullable   `json:"lensModel,omitzero"`
	LibraryID        IDFilterNullable       `json:"libraryId,omitzero"`
	Make             StringFilterNullable   `json:"make,omitzero"`
	Model            StringFilterNullable   `json:"model,omitzero"`
	Ocr              StringSimilarityFilter `json:"ocr,omitzero"`
	OriginalFileName StringPatternFilter    `json:"originalFileName,omitzero"`
	OriginalPath     StringPatternFilter    `json:"originalPath,omitzero"`
	PersonIDs        IDsFilter              `json:"personIds,omitzero"`
	Rating           NumberFilterNullable   `json:"rating,omitzero"`
	State            StringFilterNullable   `json:"state,omitzero"`
	TagIDs           IDsFilter              `json:"tagIds,omitzero"`
	TakenAt          DateFilter             `json:"takenAt,omitzero"`
	Type             FilterAssetType        `json:"type,omitzero"`
	UpdatedAt        DateFilter             `json:"updatedAt,omitzero"`
	Visibility       FilterAssetVisibility  `json:"visibility,omitzero"`
}

type SearchFilter struct {
	AlbumIDs         IDsFilter              `json:"albumIds,omitzero"`
	Checksum         StringFilter           `json:"checksum,omitzero"`
	City             StringFilterNullable   `json:"city,omitzero"`
	Country          StringFilterNullable   `json:"country,omitzero"`
	CreatedAt        DateFilter             `json:"createdAt,omitzero"`
	Description      StringPatternFilter    `json:"description,omitzero"`
	EncodedVideoPath StringFilter           `json:"encodedVideoPath,omitzero"`
	FileSizeInBytes  NumberFilter           `json:"fileSizeInBytes,omitzero"`
	HasAlbums        BoolFilter             `json:"hasAlbums,omitzero"`
	HasPeople        BoolFilter             `json:"hasPeople,omitzero"`
	HasTags          BoolFilter             `json:"hasTags,omitzero"`
	ID               IDFilter               `json:"id,omitzero"`
	IsEncoded        BoolFilter             `json:"isEncoded,omitzero"`
	IsFavorite       BoolFilter             `json:"isFavorite,omitzero"`
	IsMotion         BoolFilter             `json:"isMotion,omitzero"`
	IsOffline        BoolFilter             `json:"isOffline,omitzero"`
	LensModel        StringFilterNullable   `json:"lensModel,omitzero"`
	LibraryID        IDFilterNullable       `json:"libraryId,omitzero"`
	Make             StringFilterNullable   `json:"make,omitzero"`
	Model            StringFilterNullable   `json:"model,omitzero"`
	Ocr              StringSimilarityFilter `json:"ocr,omitzero"`
	Or               *[]SearchFilterBranch  `json:"or,omitempty,omitzero"`
	OriginalFileName StringPatternFilter    `json:"originalFileName,omitzero"`
	OriginalPath     StringPatternFilter    `json:"originalPath,omitzero"`
	PersonIDs        IDsFilter              `json:"personIds,omitzero"`
	Rating           NumberFilterNullable   `json:"rating,omitzero"`
	State            StringFilterNullable   `json:"state,omitzero"`
	TagIDs           IDsFilter              `json:"tagIds,omitzero"`
	TakenAt          DateFilter             `json:"takenAt,omitzero"`
	Type             FilterAssetType        `json:"type,omitzero"`
	UpdatedAt        DateFilter             `json:"updatedAt,omitzero"`
	Visibility       FilterAssetVisibility  `json:"visibility,omitzero"`
}

type SearchRequestBody struct {
	Cursor      string        `json:"cursor,omitempty"`
	Filter      SearchFilter  `json:"filter"`
	OrderBy     *SearchOrder  `json:"orderBy,omitempty,omitzero"`
	Size        int           `json:"size,omitempty"`
	WithExif    bool          `json:"withExif,omitempty"`
	WithPeople  bool          `json:"withPeople,omitempty"`
	WithStacked bool          `json:"withStacked,omitempty"`
}

type SearchMetadataResponse struct {
	Assets struct {
		Total      int     `json:"total"`
		Count      int     `json:"count"`
		Items      []Asset `json:"items"`
		NextPage   string  `json:"nextPage"`
		NextCursor string  `json:"nextCursor"`
	} `json:"assets"`
}

type LocationMetadata struct {
	Countries []string `json:"countries"`
	States    []string `json:"states"`
	Cities    []string `json:"cities"`
	Cameras   []string `json:"cameras"`
	Makes     []string `json:"makes"`
	Lenses    []string `json:"lenses"`
}

