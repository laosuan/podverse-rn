import { StyleSheet, View as RNView } from 'react-native'
import { TouchableWithoutFeedback } from 'react-native-gesture-handler'
import React from 'reactn'
import { FlatList, Icon, NavDismissIcon, Text, View } from '../components'
import { generateSections } from '../lib/filters'
import { PV } from '../resources'
import { getDefaultCategory } from '../services/category'
import { trackPageView } from '../services/tracking'

type Props = {
  navigation?: any
}

type State = {
  flatCategoryItems?: any[]
  sections?: any
  selectedCategoryItemKey?: string
  selectedCategorySubItemKey?: string
  selectedFilterItemKey?: string
  selectedSortItemKey?: string
  screenName: string
}

const testIDPrefix = 'filter_screen'

export class FilterScreen extends React.Component<Props, State> {
  static navigationOptions = ({ navigation }) => {
    return {
      title: '',
      headerLeft: <NavDismissIcon handlePress={navigation.dismiss} testID={testIDPrefix} />,
      headerRight: null
    }
  }

  constructor(props: Props) {
    super(props)

    const flatCategoryItems = this.props.navigation.getParam('flatCategoryItems') || []

    this.state = {
      flatCategoryItems,
      screenName: '',
      sections: [],
      selectedCategoryItemKey: '',
      selectedCategorySubItemKey: '',
      selectedFilterItemKey: '',
      selectedSortItemKey: ''
    }
  }

  async componentDidMount() {
    trackPageView('/filter', 'Filter Screen')
    const { navigation } = this.props
    const { flatCategoryItems } = this.state
    const screenName = navigation.getParam('screenName')
    const selectedCategoryItemKey = navigation.getParam('selectedCategoryItemKey')
    const selectedCategorySubItemKey = navigation.getParam('selectedCategorySubItemKey')
    const selectedFilterItemKey = navigation.getParam('selectedFilterItemKey')
    const selectedSortItemKey = navigation.getParam('selectedSortItemKey')

    const { newSelectedSortItemKey, sections } = generateSections({
      flatCategoryItems,
      selectedCategoryItemKey,
      selectedCategorySubItemKey,
      selectedFilterItemKey,
      selectedSortItemKey,
      screenName
    })

    this.setState({
      sections,
      selectedCategoryItemKey,
      selectedCategorySubItemKey,
      selectedFilterItemKey,
      selectedSortItemKey: newSelectedSortItemKey,
      screenName
    })
  }

  getNewLocalState = async (section: any, item: any) => {
    const { flatCategoryItems, screenName, selectedFilterItemKey } = this.state
    const options = { flatCategoryItems, screenName } as any

    if (section.value === PV.Filters._sectionFilterKey) {
      options.selectedFilterItemKey = item.value
      if (item.value === PV.Filters._categoryKey) {
        const defaultCategory = await getDefaultCategory()
        options.selectedCategoryItemKey = defaultCategory.id
      }
    } else if (section.value === PV.Filters._sectionCategoryKey) {
      if (item.parentId) {
        options.selectedCategorySubItemKey = item.value || item.id
        options.selectedCategoryItemKey = item.parentId
      } else {
        options.selectedCategoryItemKey = item.value || item.id
      }
      options.selectedFilterItemKey = selectedFilterItemKey
    } else if (section.value === PV.Filters._sectionSortKey) {
      options.selectedSortItemKey = item.value
      options.selectedFilterItemKey = selectedFilterItemKey
    }

    const {
      newSelectedCategoryItemKey,
      newSelectedCategorySubItemKey,
      newSelectedFilterItemKey,
      newSelectedSortItemKey,
      sections
    } = generateSections(options)

    return {
      selectedCategoryItemKey: newSelectedCategoryItemKey,
      selectedCategorySubItemKey: newSelectedCategorySubItemKey,
      selectedFilterItemKey: newSelectedFilterItemKey,
      selectedSortItemKey: newSelectedSortItemKey,
      sections
    }
  }

  getSelectHandler = async (section: any, item: any) => {
    const { navigation } = this.props
    let handleSelect: any
    let categoryValueOverride: string = ''
    if (section.value === PV.Filters._sectionFilterKey) {
      if (item.value === PV.Filters._categoryKey) {
        handleSelect = navigation.getParam('handleSelectCategoryItem')
        const defaultCategory = await getDefaultCategory()
        categoryValueOverride = defaultCategory.id
      } else {
        handleSelect = navigation.getParam('handleSelectFilterItem')
      }
    } else if (section.value === PV.Filters._sectionCategoryKey) {
      if (item.value && !item.parentId) {
        handleSelect = navigation.getParam('handleSelectCategoryItem')
      } else {
        handleSelect = navigation.getParam('handleSelectCategorySubItem')
      }
    } else if (section.value === PV.Filters._sectionSortKey) {
      handleSelect = navigation.getParam('handleSelectSortItem')
    }
    return { categoryValueOverride, handleSelect }
  }

  renderItem = ({ item, section }) => {
    const {
      selectedCategoryItemKey,
      selectedCategorySubItemKey,
      selectedFilterItemKey,
      selectedSortItemKey
    } = this.state

    const value = item.value || item.id

    /* Do not render category cells unless the category filter is active. */
    if (
      section.value === PV.Filters._sectionCategoryKey &&
      selectedFilterItemKey === PV.Filters._categoryKey &&
      selectedCategoryItemKey &&
      item.parentId &&
      selectedCategoryItemKey !== item.parentId
    ) {
      return <RNView />
    }

    let isActive = false
    if (section.value === PV.Filters._sectionCategoryKey) {
      if (selectedCategorySubItemKey) {
        if (item.parentId && item.id === selectedCategorySubItemKey) {
          isActive = true
        }
      } else if (item.value && item.value === selectedCategoryItemKey) {
        isActive = true
      }
    } else {
      isActive = [selectedFilterItemKey, selectedSortItemKey].includes(value)
    }

    const isSubCategory = item.parentId
    const itemTextStyle = isSubCategory ? [styles.itemSubText] : [styles.itemText]

    return (
      <TouchableWithoutFeedback
        onPress={async () => {
          const { categoryValueOverride, handleSelect } = await this.getSelectHandler(section, item)
          const newState = (await this.getNewLocalState(section, item)) as any

          this.setState(newState, async () => {
            handleSelect(categoryValueOverride || value)
          })
        }}>
        <View style={styles.itemWrapper}>
          <Text style={itemTextStyle}>{item.label || item.title}</Text>
          {isActive && <Icon style={styles.itemIcon} name='check' size={24} />}
        </View>
      </TouchableWithoutFeedback>
    )
  }

  render() {
    const { sections } = this.state

    return (
      <View style={styles.view}>
        <FlatList
          disableLeftSwipe={true}
          disableNoResultsMessage={true}
          keyExtractor={(item: any) => item.value || item.id}
          renderSectionHeader={({ section }) => {
            return (
              <View style={styles.sectionItemWrapper}>
                <Text style={styles.sectionItemText}>{section.title}</Text>
              </View>
            )
          }}
          renderItem={this.renderItem}
          sections={sections}
        />
      </View>
    )
  }
}

const styles = StyleSheet.create({
  hideItem: {
    height: 0
  },
  itemIcon: {
    marginTop: 4
  },
  itemSubText: {
    fontSize: PV.Fonts.sizes.xxxl,
    fontWeight: PV.Fonts.weights.semibold,
    paddingLeft: 64,
    paddingRight: 36
  },
  itemText: {
    fontSize: PV.Fonts.sizes.xxxl,
    fontWeight: PV.Fonts.weights.semibold,
    paddingHorizontal: 36
  },
  itemWrapper: {
    flexDirection: 'row',
    marginBottom: 20
  },
  sectionItemText: {
    fontSize: PV.Fonts.sizes.xxxl,
    fontWeight: PV.Fonts.weights.bold,
    paddingHorizontal: 16
  },
  sectionItemWrapper: {
    marginBottom: 20,
    marginTop: 28
  },
  view: {
    backgroundColor: 'blue',
    flex: 1
  }
})